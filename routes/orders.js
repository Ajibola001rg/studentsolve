const express = require('express');
const router = express.Router();
const { run, query, get } = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');

// POST /api/orders (Create order with optional multipart uploads)
router.post('/', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    const {
      service,
      subject,
      deadline,
      referencing,
      instructions,
      volume,
      unitTitle,
      amount,
      paymentRef
    } = req.body;

    if (!service || !instructions || !deadline) {
      return res.status(400).json({ error: 'Missing mandatory task fields' });
    }

    const orderId = 'SS-' + Math.floor(100000 + Math.random() * 900000);
    const numericAmount = parseInt(amount, 10) || 0;
    const initialStage = paymentRef ? 1 : 0;
    const status = paymentRef ? 'Settlement Confirmed' : 'Consultation Scheduled';
    const paidAt = paymentRef ? new Date().toISOString() : null;

    await run(
      `INSERT INTO orders (id, user_id, service, subject, deadline, referencing, instructions, volume, unit_title, amount, status, stage, payment_ref, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        req.user.id,
        service,
        subject || 'General Inquiry',
        deadline,
        referencing || 'APA 7th Edition',
        instructions,
        parseInt(volume, 10) || 1,
        unitTitle || 'Units',
        numericAmount,
        status,
        initialStage,
        paymentRef || null,
        paidAt
      ]
    );

    // Save uploaded file records
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await run(
          `INSERT INTO project_files (order_id, filename, original_name, size_bytes) VALUES (?, ?, ?, ?)`,
          [orderId, file.filename, file.originalname, file.size]
        );
      }
    }

    // Insert welcoming note in chat thread
    const userFirstName = req.user.name ? req.user.name.split(' ')[0] : 'Student';
    await run(
      `INSERT INTO project_messages (order_id, sender_role, sender_name, message) VALUES (?, ?, ?, ?)`,
      [
        orderId,
        'specialist',
        'StudentSolve Support',
        `Welcome ${userFirstName}! Order ${orderId} has been initiated in our system.`
      ]
    );

    res.status(201).json({ success: true, orderId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create order record' });
  }
});

// GET /api/orders (Student's projects with attached files and messages)
router.get('/', requireAuth, async (req, res) => {
  try {
    const orders = await query(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );

    const fullProjects = await Promise.all(
      orders.map(async (order) => {
        const files = await query(
          `SELECT original_name FROM project_files WHERE order_id = ?`,
          [order.id]
        );
        const messages = await query(
          `SELECT sender_role AS "from", message AS "text", created_at FROM project_messages WHERE order_id = ? ORDER BY created_at ASC`,
          [order.id]
        );

        return {
          id: order.id,
          service: order.service,
          subject: order.subject,
          deadline: order.deadline,
          referencing: order.referencing,
          instructions: order.instructions,
          volume: order.volume,
          unitTitle: order.unit_title,
          amount: order.amount,
          status: order.status,
          stage: order.stage,
          specialist: order.specialist,
          paymentRef: order.payment_ref,
          paidAt: order.paid_at,
          files: files.map((f) => f.original_name),
          messages: messages.map((m) => ({
            from: m.from === 'student' ? 'me' : 'specialist',
            text: m.text
          }))
        };
      })
    );

    res.json({ projects: fullProjects });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load projects' });
  }
});

// POST /api/orders/:id/messages (Post a chat note to order thread)
router.post('/:id/messages', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

    const order = await get('SELECT id, user_id FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const role = req.user.role === 'admin' ? 'specialist' : 'student';
    await run(
      `INSERT INTO project_messages (order_id, sender_role, sender_name, message) VALUES (?, ?, ?, ?)`,
      [order.id, role, req.user.name || 'User', text.trim()]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;