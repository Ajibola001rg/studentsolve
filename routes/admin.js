const express = require('express');
const router = express.Router();
const { query, run, get } = require('../database/db');
const { requireAdmin } = require('../middleware/auth');

// Protect all routes in this file
router.use(requireAdmin);

// GET /api/admin/metrics
router.get('/metrics', async (req, res) => {
  try {
    const totalUsers = await get("SELECT COUNT(*) as count FROM users WHERE role = 'student'");
    const totalOrders = await get('SELECT COUNT(*) as count FROM orders');
    const totalRevenue = await get('SELECT SUM(amount) as sum FROM orders WHERE payment_ref IS NOT NULL');
    const pendingOrders = await get('SELECT COUNT(*) as count FROM orders WHERE stage < 4');

    res.json({
      students: totalUsers?.count || 0,
      orders: totalOrders?.count || 0,
      revenue: totalRevenue?.sum || 0,
      activeProjects: pendingOrders?.count || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve platform metrics' });
  }
});

// GET /api/admin/orders
router.get('/orders', async (req, res) => {
  try {
    const orders = await query(`
      SELECT o.*, u.full_name as student_name, u.email as student_email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `);
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve orders' });
  }
});

// PATCH /api/admin/orders/:id
router.patch('/orders/:id', async (req, res) => {
  try {
    const { stage, specialist, status } = req.body;
    await run(
      `UPDATE orders SET 
        stage = COALESCE(?, stage), 
        specialist = COALESCE(?, specialist), 
        status = COALESCE(?, status) 
       WHERE id = ?`,
      [stage !== undefined ? stage : null, specialist || null, status || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

module.exports = router;