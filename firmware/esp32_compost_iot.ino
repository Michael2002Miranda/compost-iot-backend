/*
 * Firmware del prototipo — ESP32 + DHT11 (+ pH simulado)
 * Tesis: Aplicación móvil con IoT para monitorear el proceso de compostaje
 *        en El Porvenir, 2026.
 *
 * Envía cada lectura al backend por HTTPS con el código de la compostera.
 *
 * ANTES DE CARGAR:
 *   1. Ajuste WIFI_SSID y WIFI_PASSWORD a la red de la vivienda.
 *   2. Copie CODIGO_DISPOSITIVO tal como aparece en la app, al registrar la
 *      compostera (pantalla "Compostera registrada").
 *   3. Si el backend exige clave, defina API_KEY con el valor de DEVICE_API_KEY.
 *
 * Nota: el prototipo aún no tiene sensor de pH. El valor se simula en el rango
 * 6.8–7.4 y se envía con ph_simulado = true para que la app lo advierta y no se
 * confunda con una medición real.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "DHT.h"

// ------------------------- Configuración -------------------------
#define DHTPIN 13
#define DHTTYPE DHT11

const char* WIFI_SSID     = "MIRANDA_2.4G";
const char* WIFI_PASSWORD = "60779890@_";

// Debe coincidir con el código que muestra la aplicación al registrar la compostera.
const char* CODIGO_DISPOSITIVO = "CMP-XXXX";

// Endpoint del backend (Render)
const char* SERVER_URL = "https://compost-iot-backend.onrender.com/api/mediciones";

// Clave del dispositivo (dejar vacío si el backend no la exige)
const char* API_KEY = "";

const unsigned long INTERVALO_MS = 5000;   // cada cuánto se envía una lectura
const int MAX_INTENTOS = 3;

DHT dht(DHTPIN, DHTTYPE);
unsigned long ultimoEnvio = 0;

void conectarWifi() {
  Serial.print("Conectando a Wi-Fi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Conectado. IP: ");
  Serial.println(WiFi.localIP());
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  delay(200);
  Serial.println("Iniciando sensor DHT11...");
  conectarWifi();
}

bool enviarLectura(float temperatura, float humedad, float ph) {
  for (int intento = 1; intento <= MAX_INTENTOS; intento++) {
    WiFiClientSecure cliente;
    cliente.setInsecure(); // Prototipo: no se valida la cadena de certificados.

    HTTPClient http;
    http.begin(cliente, SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    if (strlen(API_KEY) > 0) {
      http.addHeader("x-api-key", API_KEY);
    }
    http.setTimeout(10000);

    StaticJsonDocument<256> doc;
    doc["codigo_dispositivo"] = CODIGO_DISPOSITIVO;
    doc["temperatura"] = temperatura;
    doc["humedad"] = humedad;
    doc["ph"] = ph;
    doc["ph_simulado"] = true;

    String cuerpo;
    serializeJson(doc, cuerpo);

    int codigo = http.POST(cuerpo);
    http.end();

    if (codigo == 201 || codigo == 200) {
      Serial.printf("Enviado [HTTP %d]\n", codigo);
      return true;
    }

    Serial.printf("Reintento %d/%d (HTTP %d)\n", intento, MAX_INTENTOS, codigo);
    delay(1000);
  }
  return false;
}

void loop() {
  if (millis() - ultimoEnvio < INTERVALO_MS) return;
  ultimoEnvio = millis();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi perdido, reconectando...");
    conectarWifi();
    return;
  }

  float temperatura = dht.readTemperature();
  float humedad = dht.readHumidity();

  if (isnan(temperatura) || isnan(humedad)) {
    Serial.println("Error de lectura del DHT11");
    return;
  }

  float ph = random(680, 741) / 100.0; // 6.80 – 7.40

  Serial.printf("Lectura -> %.2f C | %.2f %% | pH %.2f\n", temperatura, humedad, ph);

  if (!enviarLectura(temperatura, humedad, ph)) {
    Serial.println("No se pudo enviar la lectura tras los reintentos.");
  }
}
