const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: "postgresql://dbvuelos_user:DB6w656h8bRWgyRQAJCSKME8fnxpZPh1@dpg-d0i2ceq4d50c73b1b1p0-a.oregon-postgres.render.com/dbvuelos",
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const crearTablas = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vuelos (
        id SERIAL PRIMARY KEY,
        origen VARCHAR(100) NOT NULL,
        destino VARCHAR(100) NOT NULL,
        fecha_salida TIMESTAMP NOT NULL,
        fecha_llegada TIMESTAMP NOT NULL CHECK (fecha_llegada > fecha_salida),
        limite_personas INTEGER NOT NULL CHECK (limite_personas > 0)
      );

      CREATE TABLE IF NOT EXISTS pasajeros (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        nacionalidad VARCHAR(50) NOT NULL,
        vuelo_id INTEGER NOT NULL REFERENCES vuelos(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tripulantes (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        nacionalidad VARCHAR(50) NOT NULL,
        puesto VARCHAR(50) NOT NULL,
        vuelo_id INTEGER NOT NULL REFERENCES vuelos(id) ON DELETE CASCADE
      );
    `);
    console.log("✅ Tablas creadas o ya existen.");
  } catch (error) {
    console.error("❌ Error al crear tablas:", error);
  }
};

app.get("/api/vuelos", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM vuelos ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/vuelos", async (req, res) => {
  const { origen, destino, fecha_salida, fecha_llegada, limite_personas } = req.body;
  try {
    await pool.query(
      "INSERT INTO vuelos (origen, destino, fecha_salida, fecha_llegada, limite_personas) VALUES ($1, $2, $3, $4, $5)",
      [origen, destino, fecha_salida, fecha_llegada, limite_personas]
    );
    res.status(201).json({ message: "Vuelo registrado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/pasajeros", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, v.origen, v.destino, v.fecha_salida, v.fecha_llegada 
      FROM pasajeros p 
      JOIN vuelos v ON p.vuelo_id = v.id
      ORDER BY p.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pasajeros", async (req, res) => {
  const { nombre, nacionalidad, vuelo_id } = req.body;
  try {
    const count = await pool.query(`
      SELECT COUNT(*) AS total FROM (
        SELECT id FROM pasajeros WHERE vuelo_id = $1
        UNION ALL
        SELECT id FROM tripulantes WHERE vuelo_id = $1
      ) AS personas
    `, [vuelo_id]);

    const limite = await pool.query("SELECT limite_personas FROM vuelos WHERE id = $1", [vuelo_id]);

    if (parseInt(count.rows[0].total) >= parseInt(limite.rows[0].limite_personas)) {
      return res.status(400).json({ error: "Se ha alcanzado el límite total de personas para este vuelo." });
    }

    await pool.query(
      "INSERT INTO pasajeros (nombre, nacionalidad, vuelo_id) VALUES ($1, $2, $3)",
      [nombre, nacionalidad, vuelo_id]
    );
    res.status(201).json({ message: "Pasajero registrado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tripulantes", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, v.origen, v.destino, v.fecha_salida, v.fecha_llegada 
      FROM tripulantes t 
      JOIN vuelos v ON t.vuelo_id = v.id
      ORDER BY t.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tripulantes", async (req, res) => {
  const { nombre, nacionalidad, puesto, vuelo_id } = req.body;
  try {
    const count = await pool.query(`
      SELECT COUNT(*) AS total FROM (
        SELECT id FROM pasajeros WHERE vuelo_id = $1
        UNION ALL
        SELECT id FROM tripulantes WHERE vuelo_id = $1
      ) AS personas
    `, [vuelo_id]);

    const limite = await pool.query("SELECT limite_personas FROM vuelos WHERE id = $1", [vuelo_id]);

    if (parseInt(count.rows[0].total) >= parseInt(limite.rows[0].limite_personas)) {
      return res.status(400).json({ error: "Se ha alcanzado el límite total de personas para este vuelo." });
    }

    await pool.query(
      "INSERT INTO tripulantes (nombre, nacionalidad, puesto, vuelo_id) VALUES ($1, $2, $3, $4)",
      [nombre, nacionalidad, puesto, vuelo_id]
    );
    res.status(201).json({ message: "Tripulante registrado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
  crearTablas();
});