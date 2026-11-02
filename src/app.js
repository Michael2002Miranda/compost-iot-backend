const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let medicionesMemoria = [];

app.get("/", (req, res) => {
    res.json({ mensaje: "API Monitoreo Compostaje IoT - El Porvenir 2026", total: medicionesMemoria.length });
});

app.post("/api/mediciones", (req, res) => {
    const { id_compostera, temperatura, humedad, ph } = req.body;

    const nuevaMedicion = {
        id: medicionesMemoria.length + 1,
        id_compostera: id_compostera || 1,
        temperatura: parseFloat(temperatura),
        humedad: parseFloat(humedad),
        ph: parseFloat(ph),
        fecha_hora: new Date().toISOString()
    };

    let alerta = null;
    if (nuevaMedicion.temperatura > 65) alerta = "Temperatura critica (Supera umbral termofilico)";
    if (nuevaMedicion.humedad < 40) alerta = "Humedad baja (Compost muy seco)";

    medicionesMemoria.push(nuevaMedicion);
    console.log(`[IoT RECIBIDO] Temp: ${temperatura}°C | Humedad: ${humedad}% | pH: ${ph}`);

    res.status(201).json({ status: "success", data: nuevaMedicion, alerta });
});

app.get("/api/mediciones", (req, res) => {
    res.json({ status: "success", data: medicionesMemoria });
});

app.listen(PORT, () => {
    console.log(`Servidor Backend corriendo en http://localhost:${PORT}`);
});
