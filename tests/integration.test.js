const { expect } = require('chai');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const TEST_PORT = 3099;
const ADMIN_PASSWORD = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'data', 'admin_password.txt'), 'utf8').trim();
  } catch {
    return 'Z-123456';
  }
})();

describe('Integration tests', function() {
  this.timeout(10000);

  let server;
  let baseUrl;

  before(() => {
    process.env.PORT = String(TEST_PORT);
    // Clear any cached server module
    delete require.cache[require.resolve('../server')];
    server = require('../server');
    baseUrl = `http://localhost:${TEST_PORT}`;
  });

  after(() => {
    if (server && server.close) {
      server.close();
    }
  });

  it('GET / returns 302 redirect', (done) => {
    http.get(`${baseUrl}/`, (res) => {
      expect(res.statusCode).to.equal(302);
      done();
    }).on('error', done);
  });

  it('GET /captain returns HTML', (done) => {
    http.get(`${baseUrl}/captain`, (res) => {
      expect(res.statusCode).to.equal(200);
      expect(res.headers['content-type']).to.include('html');
      done();
    }).on('error', done);
  });

  it('GET /player returns HTML', (done) => {
    http.get(`${baseUrl}/player`, (res) => {
      expect(res.statusCode).to.equal(200);
      expect(res.headers['content-type']).to.include('html');
      done();
    }).on('error', done);
  });

  it('GET /admin returns HTML', (done) => {
    http.get(`${baseUrl}/admin`, (res) => {
      expect(res.statusCode).to.equal(200);
      expect(res.headers['content-type']).to.include('html');
      done();
    }).on('error', done);
  });

  it('WebSocket admin can connect and login', (done) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/?role=admin`);
    const messages = [];

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'admin_login', payload: { password: ADMIN_PASSWORD } }));
    });

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.some(m => m.type === 'admin_login_result')) {
        const loginResult = messages.find(m => m.type === 'admin_login_result');
        expect(loginResult.payload.success).to.be.true;
        ws.close();
        done();
      }
    });

    ws.on('error', done);
  });

  it('WebSocket admin login fails with wrong password', (done) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/?role=admin`);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'admin_login', payload: { password: 'wrong' } }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'admin_login_result') {
        expect(msg.payload.success).to.be.false;
        ws.close();
        done();
      }
    });

    ws.on('error', done);
  });

  it('WebSocket captain can connect and receive init', (done) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/?role=captain`);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'init_for_captain') {
        expect(msg.payload).to.have.property('teams');
        expect(msg.payload).to.have.property('shown');
        expect(msg.payload).to.have.property('timer');
        ws.close();
        done();
      }
    });

    ws.on('error', done);
  });

  it('WebSocket player can connect and receive init', (done) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/?role=player`);

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'init_for_player') {
        expect(msg.payload).to.have.property('shown');
        expect(msg.payload).to.have.property('timer');
        ws.close();
        done();
      }
    });

    ws.on('error', done);
  });

  it('WebSocket unknown role gets closed', (done) => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}/?role=unknown`);

    const timer = setTimeout(() => {
      ws.close();
      done(new Error('Connection was not closed'));
    }, 3000);

    ws.on('close', () => {
      clearTimeout(timer);
      done();
    });

    ws.on('error', () => {});
  });
});
