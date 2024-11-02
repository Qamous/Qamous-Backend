import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as testSession from 'supertest-session';
import * as session from 'express-session';
import { AppModule } from '../src/app.module';
import * as mysql from 'mysql2/promise';
import { v4 as uuidV4 } from 'uuid';
import * as passport from 'passport';
import { PoolOptions } from 'mysql2';

let appSession = null;

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const mySqlStore = require('express-mysql-session')(session);

    // TODO: Should I switch to a TypeORM store (https://www.youtube.com/watch?v=7DEByCGk4rQ&list=PL_cUvD4qzbkw-phjGK2qq0nQiG6gw1cKK&index=22&ab_channel=AnsontheDeveloper)?
    const TEN_MINUTES: number = 1000 * 60 * 10;

    const options: PoolOptions = {
      connectionLimit: 10,
      connectTimeout: 1000, // Increased timeout for better stability
      host: 'localhost',
      port: 3306, // db port
      user: 'root',
      password: 'example',
      database: 'test_1',
    };

    const pool: mysql.Pool = mysql.createPool(options);
    const sessionStore = new mySqlStore(options, pool);

    // Set up the session middleware
    app.use(
      session({
        name: process.env.SESS_NAME,
        genid: function () {
          return uuidV4();
        },
        secret: '1234',
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
          httpOnly: true,
          maxAge: TEN_MINUTES,
          sameSite: 'lax', // TODO: SameSite is 'lax' or 'strict' for local testing, do the research for production
        },
        rolling: true, // Reset the maxAge on every request
      }),
    );

    // Initialize and set up the Passport session middleware
    app.use(passport.initialize());
    app.use(passport.session());
    appSession = testSession((await app.init()).getHttpServer());
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/ (POST) register user', () => {
    return request(app.getHttpServer())
      .post('/users/register')
      .send({
        firstName: 'firstName',
        lastName: 'lastName',
        email: `${Date.now()}-email@gmail.com`,
        username: 'dev',
        password: 'passowrd',
        passwordConfirmation: 'password',
        dateOfBirth: new Date(),
        createdAt: new Date(),
      })
      .then((res) => {
        console.log(res.body);
        expect(res.status).toBe(201);
      });
  });

  it('/ (POST) login', () => {
    return appSession
      .post('/auth/login')
      .send({
        username: 'dev',
        password: 'passowrd',
      })
      .then((res) => {
        console.log(res.body);
        expect(res.body.username).toBe('dev');
        expect(res.status).toBe(201);
      });
  });

  it('/ (POST) check auth', (done) => {
    let authSession = null;
    appSession
      .post('/auth/login')
      .send({
        username: 'dev',
        password: 'passowrd',
      })
      .then(() => {
        authSession = appSession;
        authSession.get('/auth/session').then((res) => {
          console.log(res.body);
          // expect(res.body.username).toBe('dev');
          expect(res.status).toBe(200);
          done();
        });
      });
  });

  it('/ (POST) check auth like api', (done) => {
    let authSession = null;
    appSession
      .post('/auth/login')
      .send({
        username: 'dev',
        password: 'passowrd',
      })
      .then(() => {
        authSession = appSession;
        authSession.get('/reactions/70/likes').then((res) => {
          console.log(res.body);
          // expect(res.body.username).toBe('dev');
          expect(res.status).toBe(200);
          done();
        });
      });
  });
});
