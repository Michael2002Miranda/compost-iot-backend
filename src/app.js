const express = require("express");
const cors = require("cors");
const pool = require("./db");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Endpoint raíz para comprobar estado y total de registros en BD
app.get("/", async (req, res) => {
    try {
        const countResult = await pool.query("SELECT COUNT(*) FROM mediciones;");
        res.json({ 
            mensaje: "API Monitoreo Compostaje IoT - El Porvenir 2026", 
            total: parseInt(countResult.rows[0].count, 10) 
        });
    } catch (error) {
        console.error("Error al consultar el total de registros:", error);
        res.status(500).json({ error: "Error al obtener el estado de la base de datos" });
    }
});

// Guardar nueva medición en PostgreSQL (Llamado por la ESP32)
app.post("/api/mediciones", async (req, res) => {
    const { id_compostera, temperatura, humedad, ph } = req.body;

    try {
        const query = `
            INSERT INTO mediciones (id_compostera, temperatura, humedad, ph)
            VALUES ($1, $2, $3, $4) RETURNING *;
        `;
        const values = [
            id_compostera || 1, 
            parseFloat(temperatura), 
            parseFloat(humedad), 
            parseFloat(ph)
        ];
        
        const result = await pool.query(query, values);
        const nuevaMedicion = result.rows[0];

        let alerta = null;
        if (nuevaMedicion.temperatura > 65) alerta = "Temperatura critica (Supera umbral termofilico)";
        if (nuevaMedicion.humedad < 40) alerta = "Humedad baja (Compost muy seco)";

        console.log(`[IoT RECIBIDO BD] Temp: ${nuevaMedicion.temperatura}°C | Humedad: ${nuevaMedicion.humedad}% | pH: ${nuevaMedicion.ph}`);

        res.status(201).json({ status: "success", data: nuevaMedicion, alerta });
    } catch (error) {
        console.error("Error al insertar en la base de datos:", error);
        res.status(500).json({ error: "Error interno al guardar la medición" });
    }
});

// Obtener el historial de mediciones (Llamado por Flutter para gráficos)
app.get("/api/mediciones", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM mediciones ORDER BY fecha_hora DESC LIMIT 50;");
        res.json({ status: "success", data: result.rows });
    } catch (error) {
        console.error("Error al obtener las mediciones:", error);
        res.status(500).json({ error: "Error interno al consultar las mediciones" });
    }
});

// Obtener solo la última medición (Para tarjetas principales del Dashboard Flutter)
app.get("/api/mediciones/ultima", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM mediciones ORDER BY fecha_hora DESC LIMIT 1;");
        if (result.rows.length === 0) {
            return res.status(404).json({ status: "empty", mensaje: "No hay mediciones registradas aún" });
        }
        res.json({ status: "success", data: result.rows[0] });
    } catch (error) {
        console.error("Error al obtener la última medición:", error);
        res.status(500).json({ error: "Error interno al consultar la base de datos" });
    }
});

// Escuchar en 0.0.0.0 para aceptar peticiones de la ESP32 y clientes de la LAN
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Backend activo y escuchando en http://0.0.0.0:${PORT}`);
});