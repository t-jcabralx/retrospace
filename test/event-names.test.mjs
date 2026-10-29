import test from 'node:test'
import assert from 'node:assert/strict'
import { namesFromCsv } from '../src/ui/event/names.js'

test('one name per line, with blanks and extra spaces ignored', () => {
  assert.deepEqual(namesFromCsv('Maria\n  John   Smith \n\nPriya\r\nChen\n'), ['Maria', 'John Smith', 'Priya', 'Chen'])
})

test('a header called Name is skipped and that column is used, wherever it is', () => {
  assert.deepEqual(namesFromCsv('Email,Name,Team\nm@x.com,Maria Santos,A\nj@x.com,John,B\n'), ['Maria Santos', 'John'])
  assert.deepEqual(namesFromCsv('Name\nMaria\nJohn'), ['Maria', 'John'])
})

test('without a header the first column is used, and quoted cells keep their commas', () => {
  assert.deepEqual(namesFromCsv('"Santos, Maria",A\nJohn,B'), ['Santos, Maria', 'John'])
  assert.deepEqual(namesFromCsv('"He said ""hi""",x\nJohn,y'), ['He said "hi"', 'John'])
})

test('a single row of several cells is a list of names; semicolons and tabs work; a BOM is ignored', () => {
  assert.deepEqual(namesFromCsv('Maria, John, Priya'), ['Maria', 'John', 'Priya'])
  assert.deepEqual(namesFromCsv('Name;Team\nMaria;A\nJohn;B'), ['Maria', 'John'])
  assert.deepEqual(namesFromCsv('﻿Name\tTeam\nMaria\tA'), ['Maria'])
})

test('empty input, junk and huge files are safe', () => {
  assert.deepEqual(namesFromCsv(''), [])
  assert.deepEqual(namesFromCsv(null), [])
  assert.deepEqual(namesFromCsv(',,,\n,,'), [])
  assert.equal(namesFromCsv(Array.from({ length: 5000 }, (_, i) => `P${i}`).join('\n')).length, 2000)
})
