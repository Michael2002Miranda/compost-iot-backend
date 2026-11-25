/*
 * Firmware del prototipo — ESP32 + DHT11 (+ pH simulado)
 * Tesis: Aplicación móvil con IoT para monitorear el proceso de compostaje
 *        en El Porvenir, 2026.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONFIGURACIÓN SIN COMPUTADORA
 *
 *  Este firmware NO lleva el WiFi ni el código escritos en el código fuente.
 *  La primera vez (o al cambiar de casa) el equipo abre su propia red:
 *
 *    1. Conectar el celular a la red  «CompostIoT-Setup»
 *    2. Se abre sola una página (o entrar a 192.168.4.1)
 *    3. Elegir el WiFi de la casa, escribir la contraseña y el CÓDIGO de la
 *       compostera que muestra la aplicación (por ejemplo CMP-4F2A)
 *    4. Guardar. El equipo se reinicia y empieza a enviar.
 *
 *  Para volver a configurarlo: mantener pulsado el botón BOOT (GPIO0) durante
 *  3 segundos.
 *
 *  LIBRERÍAS NECESARIAS (Gestor de librerías de Arduino):
 *    - WiFiManager        (tzapu)          versión 2.0.17 o superior
 *    - ArduinoJson        (Benoit Blanchon) versión 6.x
 *    - DHT sensor library (Adafruit)  +  Adafruit Unified Sensor
 *    - ESP32 board package (Espressif)
 *
 *  Placa: "ESP32 Dev Module". No requiere cambios entre equipos.
 * ─────────────────────────────────────────────────────────────────────────────
 */

#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "DHT.h"

// ------------------------- Configuración fija -------------------------
#define DHTPIN 13
#define DHTTYPE DHT11
#define BOTON_CONFIG 0          // botón BOOT de la placa
#define LED_ESTADO 2            // LED integrado de la mayoría de las placas

const char* SERVER_URL = "https://compost-iot-backend.onrender.com/api/mediciones";

// Clave del dispositivo (dejar vacío si el backend no la exige)
const char* API_KEY = "";

const char* NOMBRE_PORTAL = "CompostIoT-Setup";
const unsigned long INTERVALO_MS = 5000;      // una lectura cada 5 s
const unsigned long ESPERA_WIFI_MS = 30000;   // si pierde la red, reabre el portal
const int MAX_INTENTOS = 3;

DHT dht(DHTPIN, DHTTYPE);
Preferences preferencias;

String codigoCompostera = "";
String identificadorEquipo = "";
unsigned long ultimoEnvio = 0;
unsigned long sinWifiDesde = 0;

// ------------------------- Portal de configuración -------------------------
WiFiManager gestorWifi;

// Campo extra del portal: el código que la app muestra al registrar la compostera.
WiFiManagerParameter* campoCodigo = nullptr;

void guardarParametros() {
  if (campoCodigo == nullptr) return;
  String valor = String(campoCodigo->getValue());
  valor.trim();
  valor.toUpperCase();
  if (valor.length() == 0) return;

  codigoCompostera = valor;
  preferencias.putString("codigo", codigoCompostera);
  Serial.print("Código guardado: ");
  Serial.println(codigoCompostera);
}

void alAbrirPortal(WiFiManager* gestor) {
  Serial.println();
  Serial.println("── Configuración ──────────────────────────────");
  Serial.print("Conéctate a la red: ");
  Serial.println(NOMBRE_PORTAL);
  Serial.print("Luego abre: http://");
  Serial.println(WiFi.softAPIP());
  Serial.println("───────────────────────────────────────────────");
  digitalWrite(LED_ESTADO, HIGH);
}

// ------------------------- Utilidades -------------------------
void parpadear(int veces, int pausa) {
  for (int i = 0; i < veces; i++) {
    digitalWrite(LED_ESTADO, HIGH);
    delay(pausa);
    digitalWrite(LED_ESTADO, LOW);
    delay(pausa);
  }
}

void abrirPortalConfiguracion() {
  Serial.println("Abriendo portal de configuración...");
  gestorWifi.setConfigPortalTimeout(300);   // 5 minutos y reintenta
  gestorWifi.startConfigPortal(NOMBRE_PORTAL);
}

// ------------------------- Envío de datos -------------------------
bool enviarLectura(float temperatura, float humedad, float ph) {
  for (int intento = 1; intento <= MAX_INTENTOS; intento++) {
    WiFiClientSecure cliente;
    cliente.setInsecure(); // Prototipo: no valida la cadena de certificados.

    HTTPClient http;
    http.begin(cliente, SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    if (strlen(API_KEY) > 0) {
      http.addHeader("x-api-key", API_KEY);
    }
    http.setTimeout(15000);

    StaticJsonDocument<320> doc;
    doc["codigo_dispositivo"] = codigoCompostera;
    doc["dispositivo_id"] = identificadorEquipo;
    doc["temperatura"] = temperatura;
    doc["humedad"] = humedad;
    doc["ph"] = ph;
    doc["ph_simulado"] = true;

    String cuerpo;
    serializeJson(doc, cuerpo);

    int estado = http.POST(cuerpo);
    http.end();

    if (estado == 201 || estado == 200) {
      Serial.printf("Enviado [HTTP %d] %s\n", estado, codigoCompostera.c_str());
      digitalWrite(LED_ESTADO, HIGH);
      return true;
    }

    if (estado == 400) {
      // Código inexistente: hay que revisar el portal de configuración.
      Serial.println("ERROR 400: el código de compostera no existe en la app.");
      parpadear(6, 150);
      return false;
    }

    if (estado == 409) {
      // El código ya está vinculado a otro equipo físico.
      Serial.println("ERROR 409: este código ya pertenece a otro equipo.");
      parpadear(30, 100);
      return false;
    }

    Serial.printf("Reintento %d/%d (HTTP %d)\n", intento, MAX_INTENTOS, estado);
    delay(1500);
  }
  return false;
}

// ------------------------- Arranque -------------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Compost IoT — prototipo de monitoreo");

  pinMode(LED_ESTADO, OUTPUT);
  pinMode(BOTON_CONFIG, INPUT_PULLUP);
  dht.begin();

  preferencias.begin("compost", false);
  codigoCompostera = preferencias.getString("codigo", "");

  WiFi.mode(WIFI_STA);
  identificadorEquipo = WiFi.macAddress();
  Serial.print("Equipo: ");
  Serial.println(identificadorEquipo);

  campoCodigo = new WiFiManagerParameter(
      "codigo", "Código de compostera (ej. CMP-4F2A)", codigoCompostera.c_str(), 16);

  gestorWifi.addParameter(campoCodigo);
  gestorWifi.setSaveParamsCallback(guardarParametros);
  gestorWifi.setAPCallback(alAbrirPortal);
  gestorWifi.setConfigPortalTimeout(300);
  gestorWifi.setTitle("Compost IoT");
  gestorWifi.setMinimumSignalQuality(15);

  Serial.println("Conectando al WiFi guardado...");
  if (!gestorWifi.autoConnect(NOMBRE_PORTAL)) {
    Serial.println("Sin conexión. Se reinicia para reintentar.");
    delay(2000);
    ESP.restart();
  }

  // Si el portal se guardó con un código nuevo, queda en memoria.
  if (campoCodigo != nullptr && String(campoCodigo->getValue()).length() > 0) {
    guardarParametros();
  }

  Serial.print("Conectado. IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("Compostera: ");
  Serial.println(codigoCompostera.length() > 0 ? codigoCompostera : "(sin código)");

  digitalWrite(LED_ESTADO, HIGH);
  parpadear(1, 300);
}

// ------------------------- Bucle principal -------------------------
void loop() {
  // Botón de configuración: mantener 3 segundos para reabrir el portal.
  if (digitalRead(BOTON_CONFIG) == LOW) {
    unsigned long inicio = millis();
    while (digitalRead(BOTON_CONFIG) == LOW) {
      if (millis() - inicio > 3000) {
        Serial.println("Reiniciando configuración...");
        gestorWifi.resetSettings();
        preferencias.remove("codigo");
        delay(500);
        ESP.restart();
      }
      delay(50);
    }
  }

  if (millis() - ultimoEnvio < INTERVALO_MS) return;
  ultimoEnvio = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (sinWifiDesde == 0) sinWifiDesde = millis();
    if (millis() - sinWifiDesde > ESPERA_WIFI_MS) {
      Serial.println("WiFi perdido. Abriendo portal de configuración...");
      abrirPortalConfiguracion();
      sinWifiDesde = 0;
    }
    return;
  }
  sinWifiDesde = 0;

  if (codigoCompostera.length() == 0) {
    Serial.println("Falta el código de la compostera: abre el portal CompostIoT-Setup.");
    parpadear(3, 400);
    return;
  }

  float temperatura = dht.readTemperature();
  float humedad = dht.readHumidity();

  if (isnan(temperatura) || isnan(humedad)) {
    Serial.println("Error de lectura del DHT11");
    parpadear(2, 120);
    return;
  }

  float ph = random(680, 741) / 100.0; // 6.80 – 7.40 (simulado)

  Serial.printf("Lectura -> %.2f C | %.2f %% | pH %.2f\n", temperatura, humedad, ph);
  enviarLectura(temperatura, humedad, ph);
}
