// Import required packages
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const cors = require('cors');

const { Users, Orders, OrderItems, sequelize } = require('./db')
const { Op } = require('sequelize');

// Initialize the Express app
const app = express();
const PORT = 8080;

// Use middleware
app.use(cors()); // Allows requests from your frontend
app.use(express.json()); // Parses incoming JSON payloads

// Middleware to verify JWT and protect routes
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header (e.g., "Bearer <token>")
      token = req.headers.authorization.split(' ')[1];
      
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Attach user to the request object
      req.user = await Users.findByPk(decoded.id, {
        attributes: { exclude: ['password'] } // Don't include the password
      });

      if (!req.user) {
        return res.status(401).json({ error: 'User not found' });
      }

      next(); // Proceed to the endpoint logic
    } catch (error) {
      res.status(401).json({ error: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Not authorized, no token' });
  }
};

// Define a simple root route to test the server
app.get('/', (req, res) => {
    res.status(200).send('IoT Sensor Monitor Backend is running!');
});


// Authentications API
//1.Signup api
app.post('/auth/signup', async (req, res) => {
  try {
    const { username,phone, password } = req.body;

    // 1. Check if a user with this phone already exists
    const phoneExists = await Users.findOne({ where: { phone: phone } });
    if (phoneExists) {
      // If the user exists, return a 409 Conflict status
      return res.status(409).json({ error: 'User already exists with this phone' });
    }

    // 2. Check if a user with this username already exists
    const usernameExists = await Users.findOne({ where: { username: username } });
    if (usernameExists) {
      // If the username is taken, return a 409 Conflict status
      return res.status(409).json({ error: 'Username is already taken' });
    }
    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await Users.create({ username,phone, password: hashedPassword,authority:'USER'});
    res.status(200).json({ message: 'User created successfully' });
  } catch (error) {
    res.status(500).json({ error: error });
  }
});

// POST /auth/login: Log in a user and return a JWT
app.post('/auth/login', async (req, res) => {
  try {
    const {phone, password } = req.body;
    const user = await Users.findOne({ where: { phone } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid phone or password' });
    }

    // Create a JWT. Use a secret from your .env file in a real app!
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.status(200).json({ token,authority:user.authority});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get logged-in user's details
app.get('/api/profile', protect, async (req, res) => {
  // protect middleware already attaches user data (excluding password) to req.user
  if (req.user) {
    res.status(200).json(req.user);
  } else {
    // This case should ideally be caught by 'protect' middleware already
    res.status(404).json({ error: 'User not found' });
  }
});

// Get all orders for the logged-in user (with optional date range)
app.get('/api/orders', protect, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user.id;

    // Base query: always filter by the logged-in user
    const whereClause = {
      UserId: userId,
    };

    // If startDate and endDate are provided in the URL query, add them to the filter
    if (startDate && endDate) {
      const start = new Date(`${startDate}T00:00:00.000Z`);
      const end = new Date(`${endDate}T23:59:59.999Z`);
      whereClause.date = {
        [Op.between]: [start, end],
      };
    }

    // Find all orders for this user
    const orders = await Orders.findAll({
      where: whereClause,
      include: [
        {
          model: OrderItems, // Include the items for each order
        },
      ],
      order: [['date', 'DESC']], // Show most recent orders first
    });

    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// POST /api/orders: Create a new order and its associated items
app.post('/api/orders', protect, async (req, res) => {
  const { items } = req.body;
  const userId = req.user.id;

  const t = await sequelize.transaction();

  try {
    // 1. Validate the input
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Request must include a non-empty "items" array' });
    }

    // 2. Create the parent Order to get a new 'billno'
    const order = await Orders.create({
      status:false,
      UserId: userId,
    }, { transaction: t });

    // 3. Prepare all the OrderItems
    // Add the new 'OrderId' (which is 'billno') to each item
    const itemsToCreate = items.map(item => {
      // Basic validation for each item
      if (!item.category || !item.color || !item.quantity) {
        throw new Error('Each item must include category, color, and quantity.');
      }
      return {
        ...item,
        OrderBillno: order.billno, // Link the item to the order we just created
      };
    });

    // 4. Create all OrderItems in a single database query
    await OrderItems.bulkCreate(itemsToCreate, { transaction: t });

    // 5. If everything was successful, commit the transaction
    await t.commit();

    // 6. Return the newly created order, including its items
    const newOrderDetails = await Orders.findByPk(order.billno, {
      include: [OrderItems],
    });

    res.status(201).json(newOrderDetails);

  } catch (error) {
    // 7. If any step failed, roll back the entire transaction
    await t.rollback();
    console.error('Error creating order:', error);
    res.status(500).json({ error: error.message || 'Failed to create order' });
  }
});

// Start the server and listen for connections
app.listen(PORT, () => {
    console.log(`🚀 Server is live and listening on http://localhost:${PORT}`);
});
