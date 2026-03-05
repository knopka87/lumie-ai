// src/db/schema.ts

import { Sequelize } from 'sequelize';

// Initialize a connection to the database
const sequelize = new Sequelize('database', 'username', 'password', {
  host: 'localhost',
  dialect: 'postgres', // change according to your database
});

// Define User model
const User = sequelize.define('User', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  username: {
    type: Sequelize.STRING,
    unique: true,
    allowNull: false,
  },
  password: {
    type: Sequelize.STRING,
    allowNull: false,
  },
  email: {
    type: Sequelize.STRING,
    unique: true,
    allowNull: false,
  },
}, { timestamps: true });

// Define Session model
const Session = sequelize.define('Session', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  userId: {
    type: Sequelize.INTEGER,
    references: { model: User, key: 'id' },
    allowNull: false,
  },
  createdAt: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW,
  },
}, { timestamps: false });

// Define Message model
const Message = sequelize.define('Message', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  sessionId: {
    type: Sequelize.INTEGER,
    references: { model: Session, key: 'id' },
    allowNull: false,
  },
  content: {
    type: Sequelize.TEXT,
    allowNull: false,
  },
  createdAt: {
    type: Sequelize.DATE,
    defaultValue: Sequelize.NOW,
  },
}, { timestamps: false });

// Define Embedding model
const Embedding = sequelize.define('Embedding', {
  id: {
    type: Sequelize.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  },
  messageId: {
    type: Sequelize.INTEGER,
    references: { model: Message, key: 'id' },
    allowNull: false,
  },
  vector: {
    type: Sequelize.ARRAY(Sequelize.FLOAT),
    allowNull: false,
  },
}, { timestamps: false });

// Export models
export { User, Session, Message, Embedding, sequelize as dbConnection };