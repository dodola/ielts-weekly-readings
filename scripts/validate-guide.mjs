#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { validateFullGuide } from './full-reading.mjs';

const { values } = parseArgs({ options: { source: { type: 'string' }, guide: { type: 'string' } } });
if (!values.source || !values.guide) throw new Error('--source and --guide are required.');
const source = JSON.parse(await readFile(values.source, 'utf8'));
console.log(JSON.stringify(validateFullGuide(await readFile(values.guide, 'utf8'), source.article)));
