const express = require('express');
const { db } = require('../db');
const { listTags, listTagTree, resolveTagQuery } = require('../tag-service');

const router = express.Router();

router.get('/', (req, res) => {
  const options = {
    scope: req.query.scope || 'all',
    keyword: req.query.keyword || '',
  };
  const tags = listTags(db, options);
  res.json({ tags });
});

router.get('/tree', (req, res) => {
  const options = {
    scope: req.query.scope || 'all',
    keyword: req.query.keyword || '',
  };
  res.json({ tree: listTagTree(db, options) });
});

router.get('/resolve', (req, res) => {
  const slug = resolveTagQuery(db, req.query.q || req.query.tag || '');
  res.json({ slug });
});

module.exports = router;
