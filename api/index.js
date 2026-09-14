/**
 * Vercel Serverless Function Adapter
 * Exports the Express application instance without invoking app.listen().
 */
'use strict';

const app = require('../server');

module.exports = app;
