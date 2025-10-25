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

// --- MIDDLEWARE ---

// Middleware to verify JWT and protect routes
const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1]; // Get token from header
            const decoded = jwt.verify(token, process.env.JWT_SECRET); // Verify token
            // Attach user to the request object, excluding password
            req.user = await Users.findByPk(decoded.id, {
                attributes: { exclude: ['password'] }
            });

            if (!req.user) {
                return res.status(401).json({ error: 'User not found' });
            }
            next(); // Proceed
        } catch (error) {
            console.error('Token verification failed:', error.message);
            res.status(401).json({ error: 'Not authorized, token failed' });
        }
    } else {
        res.status(401).json({ error: 'Not authorized, no token' });
    }
};

// Middleware to check if the user is an Admin
const isAdmin = (req, res, next) => {
    if (req.user && req.user.authority === 'ADMIN') {
        next(); // User is admin, proceed
    } else {
        res.status(403).json({ error: 'Forbidden: Requires admin access' }); // User is not admin
    }
};


// --- ROUTES ---

// Simple root route
app.get('/', (req, res) => {
    res.status(200).send('PGP Backend is running!');
});

// --- AUTHENTICATION ROUTES ---
// POST /auth/signup: Register a new user
app.post('/auth/signup', async (req, res) => {
    try {
        const { username, phone, password } = req.body; //

        // Check if phone or username already exists
        const phoneExists = await Users.findOne({ where: { phone: phone } });
        if (phoneExists) {
            return res.status(409).json({ message: 'User already exists with this phone' }); // Changed error field to message
        }
        const usernameExists = await Users.findOne({ where: { username: username } });
        if (usernameExists) {
            return res.status(409).json({ message: 'Username is already taken' }); // Changed error field to message
        }

        const hashedPassword = await bcrypt.hash(password, 10); // Hash password
        // Create user with USER authority by default
        await Users.create({ username, phone, password: hashedPassword, authority: 'USER' });
        res.status(201).json({ message: 'User created successfully' }); // Changed status to 201 Created
    } catch (error) {
        console.error("Signup Error:", error);
        res.status(500).json({ message: 'Internal server error during signup' }); // Changed error field to message
    }
});

// POST /auth/login: Log in a user
app.post('/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body; //
        const user = await Users.findOne({ where: { phone } }); //

        // Check user and password
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: 'Invalid phone or password' }); // Changed error field to message
        }

        // Create JWT
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.status(200).json({ token, authority: user.authority }); // Include authority
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: 'Internal server error during login' }); // Changed error field to message
    }
});

// --- USER API ROUTES (Protected) ---
const userRouter = express.Router();
userRouter.use(protect);

// GET /api/profile: Get logged-in user's details
userRouter.get('/profile', async (req, res) => {
    // User data is attached by 'protect' middleware
    res.status(200).json(req.user);
});

// GET /api/orders: Get orders for the logged-in user
userRouter.get('/orders', async (req, res) => {
    try {
        const { startDate, endDate } = req.query; //
        const userId = req.user.id; //
        const whereClause = { UserId: userId }; //

        // Add date range filter if provided
        if (startDate && endDate) {
            const start = new Date(`${startDate}T00:00:00.000Z`); //
            const end = new Date(`${endDate}T23:59:59.999Z`); //
            whereClause.date = { [Op.between]: [start, end] }; //
        }

        const orders = await Orders.findAll({
            where: whereClause,
            include: [{ model: OrderItems }], // Include items
            order: [['date', 'DESC']], // Newest first
        });
        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({ message: 'Failed to fetch orders' }); // Changed error field to message
    }
});

// POST /api/orders: Create a new order
userRouter.post('/orders', async (req, res) => {
    const { items } = req.body; //
    const userId = req.user.id; //
    const t = await sequelize.transaction(); // Start transaction

    try {
        if (!items || !Array.isArray(items) || items.length === 0) {
            await t.rollback(); // Rollback if input invalid
            return res.status(400).json({ message: 'Request must include a non-empty "items" array' }); // Changed error field to message
        }

        // Create the Order, status defaults to false
        const order = await Orders.create({ UserId: userId }, { transaction: t }); //

        // Prepare OrderItems
        const itemsToCreate = items.map(item => {
            if (!item.category || !item.color || !item.quantity) {
                throw new Error('Each item must include category, color, and quantity.'); // Will be caught and trigger rollback
            }
            // Ensure quantity is a positive integer
            const quantity = parseInt(item.quantity, 10);
            if (isNaN(quantity) || quantity <= 0) {
                 throw new Error(`Invalid quantity "${item.quantity}" for item ${item.category} - ${item.color}. Quantity must be a positive number.`);
            }
            return {
                category: item.category,
                color: item.color, // Assuming 'color' holds the name/description
                quantity: quantity,
                OrderBillno: order.billno, // Link using primary key 'billno'
            };
        });

        // Bulk create items
        await OrderItems.bulkCreate(itemsToCreate, { transaction: t, validate: true }); // Added validation

        await t.commit(); // Commit transaction

        // Fetch the created order with items to return it
        const newOrderDetails = await Orders.findByPk(order.billno, {
            include: [OrderItems],
        });

        res.status(201).json(newOrderDetails);

    } catch (error) {
        await t.rollback(); // Rollback on any error
        console.error('Error creating order:', error);
        res.status(500).json({ message: error.message || 'Failed to create order' }); // Changed error field to message
    }
});

// Mount the user router
app.use('/api', userRouter);


// --- ADMIN API ROUTES (Protected & Admin Only) ---
const adminRouter = express.Router();
adminRouter.use(protect, isAdmin); // Apply JWT protection and Admin check

// GET /api/admin/stats: Get dashboard statistics
adminRouter.get('/stats', async (req, res) => {
    try {
        const userCount = await Users.count({
            where:{authority:'USER'}
        }); // Count all users

        // Count orders in the last month
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1); //
        const recentOrderCount = await Orders.count({
            where: {
                date: {
                    [Op.gte]: oneMonthAgo, // Greater than or equal to one month ago
                }
            }
        });

        res.status(200).json({ userCount, recentOrderCount });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ message: 'Failed to fetch stats' }); // Changed error field to message
    }
});

// GET /api/admin/orders/undelivered: Get all orders with status=false
adminRouter.get('/orders/undelivered', async (req, res) => {
    try {
        const undeliveredOrders = await Orders.findAll({
            where: { status: false }, // Filter by status
            include: [
                { model: OrderItems }, // Include items
                { model: Users, attributes: ['id', 'username'] } // Include user info
            ],
            order: [['date', 'DESC']], // Newest first
        });
        res.status(200).json(undeliveredOrders);
    } catch (error) {
        console.error('Error fetching undelivered orders:', error);
        res.status(500).json({ message: 'Failed to fetch undelivered orders' }); // Changed error field to message
    }
});

// PUT /api/admin/orders/:billno/deliver: Mark an order as delivered
adminRouter.put('/orders/:billno/deliver', async (req, res) => {
    try {
        const { billno } = req.params; // Get billno from URL parameter

        const order = await Orders.findByPk(billno); // Find order by primary key 'billno'

        if (!order) {
            return res.status(404).json({ message: 'Order not found' }); // Changed error field to message
        }

        // Update status to true
        order.status = true;
        await order.save(); // Save the change

        res.status(200).json({ message: `Order ${billno} marked as delivered` });
    } catch (error) {
        console.error('Error marking order as delivered:', error);
        res.status(500).json({ message: 'Failed to update order status' }); // Changed error field to message
    }
});

// GET /api/admin/users: Get a list of all users
adminRouter.get('/users', async (req, res) => {
    try {
        const users = await Users.findAll({
            where:{authority:'USER'},
            attributes: ['id', 'username', 'phone'], // Select specific fields
            order: [['username', 'ASC']], // Order alphabetically by username
        });
        res.status(200).json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Failed to fetch users' }); // Changed error field to message
    }
});

// GET /api/admin/users/:userId: Get details for a specific user
adminRouter.get('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await Users.findByPk(userId, {
            attributes: ['id', 'username', 'phone'], // Select specific fields
        });
        if (!user) {
            return res.status(404).json({ message: 'User not found' }); // Changed error field to message
        }
        res.status(200).json(user);
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({ message: 'Failed to fetch user details' }); // Changed error field to message
    }
});

// GET /api/admin/orders: Get orders, optionally filtered by userId and date range (last month default)
adminRouter.get('/orders', async (req, res) => {
    try {
        const { userId } = req.query; // Get userId from query params

        if (!userId) {
            return res.status(400).json({ message: 'UserId query parameter is required' }); // Changed error field to message
        }

        // Define the date range for the last month
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1); //

        const orders = await Orders.findAll({
            where: {
                UserId: userId, // Filter by the specified user
                date: {
                    [Op.between]: [startDate, endDate], // Filter by date range
                }
            },
            include: [{ model: OrderItems }], // Include items
            order: [['date', 'DESC']], // Newest first
        });

        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching orders for user:', error);
        res.status(500).json({ message: 'Failed to fetch orders' }); // Changed error field to message
    }
});

// Mount the admin router
app.use('/api/admin', adminRouter);

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🚀 Server is live and listening on http://localhost:${PORT}`); //
});