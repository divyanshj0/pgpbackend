// This line must be at the very top to load the .env file
require('dotenv').config();

const { Sequelize, DataTypes } = require('sequelize');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set!");
}

const sequelize = new Sequelize(databaseUrl, {
    dialect: 'postgres',
    protocol: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false,
        },
    },
});

// 1. Users Model
const Users = sequelize.define('Users', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
},{
    timestamps:false,
});


// 2. Orders Model
const Orders = sequelize.define('Orders', {
    billno: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
    },
},{
    timestamps:false,
});

// 3. OrderItems Model 
const OrderItems = sequelize.define('OrderItems', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    category: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    color: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
}, {
    timestamps:false,
}
);

// --- Relations ---

// 1. A User can have many Orders
Users.hasMany(Orders);
Orders.belongsTo(Users); // Adds 'UserId' to Orders

// 2. An Order can have many OrderItems
Orders.hasMany(OrderItems);
OrderItems.belongsTo(Orders); // Adds 'OrderId' to OrderItems


// --- Sync Database ---
sequelize.sync({ alter: true })
    .then(() => console.log('Database synced & tables created!'))
    .catch(error => console.log('Error Syncing Database', error));

// Test the database connection
async function testConnection() {
    try {
        await sequelize.authenticate();
        console.log('☁️ Database connection has been established successfully.');
    } catch (error) {
        console.error('Unable to connect to the database:', error);
    }
}

testConnection();

// Export all models
module.exports = {
    sequelize,
    Users,
    Orders,
    OrderItems,
};