const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db, migrate } = require('./db');
const { authOptional } = require('./auth');
const { setSecurityHeaders, staticOptions } = require('./security');
const { initializeTagSystem } = require('./tag-service');

const authRoutes = require('./routes/auth');
const problemRoutes = require('./routes/problems');
const submissionRoutes = require('./routes/submissions');
const adminRoutes = require('./routes/admin');
const judgeRoutes = require('./routes/judge');
const prelimRoutes = require('./routes/prelim');
const analyticsRoutes = require('./routes/analytics');
const profileRoutes = require('./routes/profile');
const tagRoutes = require('./routes/tags');

migrate();
initializeTagSystem(db);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 3000);

app.use(setSecurityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: process.env.JSON_LIMIT || '20mb' }));
app.use(authOptional);

app.use('/api/auth', authRoutes);
app.use('/api/problems', problemRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/prelim', prelimRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/judge', express.json({ limit: '20mb' }), judgeRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

app.use('/vendor/katex', express.static(path.join(__dirname, '..', 'node_modules', 'katex', 'dist'), staticOptions('1h')));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public'), staticOptions('1h')));
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误', detail: process.env.NODE_ENV === 'production' ? undefined : String(err.stack || err.message) });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LiteOJ web server listening on http://0.0.0.0:${PORT}`);
});
