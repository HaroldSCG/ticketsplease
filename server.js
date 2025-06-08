const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { Pool } = require("pg");
const { DateTime } = require("luxon");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://dbtickets_9xrb_user:xxFkcirgyHsbZzxofglJUCnxwA2KOIFf@dpg-d12ffl15pdvs73cmiou0-a.oregon-postgres.render.com/dbtickets_9xrb",
  ssl: { rejectUnauthorized: false },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const emitirActualizacion = async () => {
  const result = await pool.query("SELECT * FROM tipo_ticket ORDER BY id");
  io.emit("actualizar_tickets", result.rows);
};

const crearTablas = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tipo_ticket (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        precio DECIMAL(10,2) NOT NULL CHECK (precio > 0),
        stock_inicial INTEGER NOT NULL CHECK (stock_inicial >= 0),
        stock_actual INTEGER NOT NULL CHECK (stock_actual >= 0)
      );

      CREATE TABLE IF NOT EXISTS ventas (
        id SERIAL PRIMARY KEY,
        fecha_hora TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
        comprador VARCHAR(100)
      );

      CREATE TABLE IF NOT EXISTS detalle_venta (
        id SERIAL PRIMARY KEY,
        venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
        tipo_ticket_id INTEGER NOT NULL REFERENCES tipo_ticket(id) ON DELETE CASCADE,
        cantidad INTEGER NOT NULL CHECK (cantidad > 0),
        subtotal DECIMAL(10,2) NOT NULL CHECK (subtotal >= 0),
        UNIQUE (venta_id, tipo_ticket_id)
      );

      -- Descontar stock al agregar detalle
      CREATE OR REPLACE FUNCTION descontar_stock()
      RETURNS TRIGGER AS $$
      DECLARE stock_disponible INTEGER;
      BEGIN
        SELECT stock_actual INTO stock_disponible FROM tipo_ticket WHERE id = NEW.tipo_ticket_id;
        IF stock_disponible < NEW.cantidad THEN
          RAISE EXCEPTION 'No hay suficiente stock para el ticket ID %: solicitado %, disponible %',
            NEW.tipo_ticket_id, NEW.cantidad, stock_disponible;
        END IF;
        UPDATE tipo_ticket SET stock_actual = stock_actual - NEW.cantidad WHERE id = NEW.tipo_ticket_id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trigger_descontar_stock ON detalle_venta;
      CREATE TRIGGER trigger_descontar_stock
        BEFORE INSERT ON detalle_venta
        FOR EACH ROW EXECUTE FUNCTION descontar_stock();

      -- Recalcular total venta después de eliminar detalle
      CREATE OR REPLACE FUNCTION actualizar_total_venta()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE ventas
        SET total = COALESCE((
          SELECT SUM(subtotal)
          FROM detalle_venta
          WHERE venta_id = OLD.venta_id
        ), 0)
        WHERE id = OLD.venta_id;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trigger_actualizar_total_venta ON detalle_venta;
      CREATE TRIGGER trigger_actualizar_total_venta
        AFTER DELETE ON detalle_venta
        FOR EACH ROW EXECUTE FUNCTION actualizar_total_venta();
    `);

    console.log("✅ Tablas y triggers creados/verificados");
  } catch (err) {
    console.error("❌ Error al crear tablas:", err);
  }
};


// ==== ENDPOINTS tipo_ticket ====
app.get("/api/tickets", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tipo_ticket ORDER BY id");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tickets/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tipo_ticket WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Ticket no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==== ENDPOINTS ventas ====
app.get("/api/ventas", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.id, 
            v.fecha_hora, 
            v.total, 
            v.comprador
      FROM ventas v
      ORDER BY v.id
    `);

    const ventasConFecha = result.rows.map(v => ({
      ...v,
      fecha: DateTime.fromJSDate(new Date(v.fecha_hora)).setZone("America/Guatemala").toISO()
    }));

    res.json(ventasConFecha);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




app.get("/api/ventas/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM ventas WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Venta no encontrada" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==== ENDPOINTS detalle_venta ====
app.get("/api/detalles", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT dv.id, 
             dv.venta_id, 
             dv.cantidad, 
             dv.subtotal, 
             tt.nombre AS descripcion
      FROM detalle_venta dv
      JOIN tipo_ticket tt ON dv.tipo_ticket_id = tt.id
      ORDER BY dv.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get("/api/detalles/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM detalle_venta WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Detalle no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==== CREACIÓN de tipo_ticket ====
app.post("/api/tickets", async (req, res) => {
  const { nombre, precio, stock_inicial, stock_actual } = req.body;
  if (!(nombre && precio > 0 && stock_inicial >= 0 && stock_actual >= 0)) {
    return res.status(400).json({ error: "Datos de ticket inválidos." });
  }
  try {
    const result = await pool.query(
      `INSERT INTO tipo_ticket (nombre, precio, stock_inicial, stock_actual)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, precio, stock_inicial, stock_actual]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==== ACTUALIZACIÓN de tipo_ticket ====
app.put("/api/tickets/:id", async (req, res) => {
  const { nombre, precio, stock_inicial, stock_actual } = req.body;
  if (!(nombre && precio > 0 && stock_inicial >= 0 && stock_actual >= 0)) {
    return res.status(400).json({ error: "Datos inválidos" });
  }
  try {
    const result = await pool.query(
      `UPDATE tipo_ticket
       SET nombre = $1, precio = $2, stock_inicial = $3, stock_actual = $4
       WHERE id = $5 RETURNING *`,
      [nombre, precio, stock_inicial, stock_actual, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Ticket no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==== ELIMINACIÓN de tipo_ticket ====
app.delete("/api/tickets/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM tipo_ticket WHERE id = $1 RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Ticket no encontrado" });
    res.json({ message: "Ticket eliminado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==== CREACIÓN de venta ====
app.post("/api/ventas", async (req, res) => {
  const { comprador, total, detalles } = req.body;
  if (!Array.isArray(detalles) || detalles.length === 0 || total < 0) {
    return res.status(400).json({ error: "Datos de venta inválidos." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ventaRes = await client.query(
      "INSERT INTO ventas (comprador, total) VALUES ($1, $2) RETURNING id",
      [comprador || null, total]
    );
    const ventaId = ventaRes.rows[0].id;
    for (const d of detalles) {
      await client.query(
        `INSERT INTO detalle_venta (venta_id, tipo_ticket_id, cantidad, subtotal)
         VALUES ($1, $2, $3, $4)`,
        [ventaId, d.tipo_ticket_id, d.cantidad, d.subtotal]
      );
    }
    await client.query("COMMIT");
    await emitirActualizacion();
    res.status(201).json({ message: "Venta registrada exitosamente." });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==== INICIO DEL SERVIDOR ====
server.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  crearTablas();
});

// ==== SOCKET.IO ====
io.on("connection", (socket) => {
  console.log("🔌 Cliente conectado");

  pool.query("SELECT * FROM tipo_ticket ORDER BY id")
    .then(result => socket.emit("actualizar_tickets", result.rows))
    .catch(err => console.error(err));
});


