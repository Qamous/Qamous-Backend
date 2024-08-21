import * as dotenv from 'dotenv';
import * as mysql from 'mysql2/promise';

// Load environment variables from .env file
dotenv.config();

async function testDatabaseConnection() {
  const options = {
    host: process.env.HOST,
    port: parseInt(process.env.PORT), // db port
    user: process.env.USER,
    password: process.env.PASSWORD,
    database: process.env.DATABASE,
  };

  try {
    const connection = await mysql.createConnection(options);
    console.log('Database connection successful');
    await connection.end();
  } catch (error) {
    console.error('Database connection failed:', error.message);
    console.log('Host:', options.host);
    console.log('Port:', options.port);
    console.log('User:', options.user);
    console.log('Database:', options.database);
  }
}

testDatabaseConnection();
