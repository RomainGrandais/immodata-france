'use strict';

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

function parseTransactionDate(row) {
  // DVF date_mutation format: "YYYY-MM-DD"
  const raw = row.date_mutation || row.date;
  if (!raw) return null;
  return new Date(raw);
}

function pricePerSqm(row) {
  const val = parseFloat(row.valeur_fonciere);
  const surf = parseFloat(row.surface_reelle_bati);
  if (!val || !surf || surf <= 0) return null;
  const ppm = val / surf;
  if (ppm < 500 || ppm > 20000) return null;
  return ppm;
}

function isHousingType(row) {
  const t = (row.type_local || '').toLowerCase();
  return t === 'appartement' || t === 'maison';
}

module.exports = { median, monthsAgo, parseTransactionDate, pricePerSqm, isHousingType };
