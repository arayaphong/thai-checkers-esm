import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  PieceColor,
  PieceType,
  isPieceColor,
  isPieceType,
  assertPieceColor,
  assertPieceType,
  assertPieceInfo,
  pieceSymbol,
  toStringPieceColor,
  toStringPieceType,
} from '../../core/piece.mjs';

describe('core/piece', () => {
  test('PieceColor values and type check', () => {
    assert.equal(PieceColor.WHITE, 0);
    assert.equal(PieceColor.BLACK, 1);
    assert.equal(isPieceColor(PieceColor.WHITE), true);
    assert.equal(isPieceColor(PieceColor.BLACK), true);
    assert.equal(isPieceColor(2), false);
    assert.equal(isPieceColor(-1), false);
    assert.equal(isPieceColor('WHITE'), false);
  });

  test('PieceType values and type check', () => {
    assert.equal(PieceType.PION, 0);
    assert.equal(PieceType.DAME, 1);
    assert.equal(isPieceType(PieceType.PION), true);
    assert.equal(isPieceType(PieceType.DAME), true);
    assert.equal(isPieceType(2), false);
    assert.equal(isPieceType(-1), false);
    assert.equal(isPieceType('PION'), false);
  });

  test('assertPieceColor throws RangeError for invalid color', () => {
    assert.doesNotThrow(() => assertPieceColor(PieceColor.WHITE));
    assert.doesNotThrow(() => assertPieceColor(PieceColor.BLACK));
    assert.throws(() => assertPieceColor(2), RangeError);
    assert.throws(() => assertPieceColor(null), RangeError);
  });

  test('assertPieceType throws RangeError for invalid type', () => {
    assert.doesNotThrow(() => assertPieceType(PieceType.PION));
    assert.doesNotThrow(() => assertPieceType(PieceType.DAME));
    assert.throws(() => assertPieceType(2), RangeError);
    assert.throws(() => assertPieceType(null), RangeError);
  });

  test('assertPieceInfo throws for invalid piece info object', () => {
    assert.doesNotThrow(() => assertPieceInfo({ color: PieceColor.WHITE, type: PieceType.PION }));
    assert.doesNotThrow(() => assertPieceInfo({ color: PieceColor.BLACK, type: PieceType.DAME }));

    assert.throws(() => assertPieceInfo(null), TypeError);
    assert.throws(() => assertPieceInfo(undefined), TypeError);
    assert.throws(() => assertPieceInfo('not an object'), TypeError);

    assert.throws(() => assertPieceInfo({ color: 2, type: PieceType.PION }), RangeError);
    assert.throws(() => assertPieceInfo({ color: PieceColor.WHITE, type: 2 }), RangeError);
  });

  test('pieceSymbol maps black and dame properties correctly to glyphs', () => {
    // White Pion (isBlack: false, isDame: false) -> '\u25CF'
    assert.equal(pieceSymbol(false, false), '\u25CF');
    // White Dame (isBlack: false, isDame: true) -> '\u25A0'
    assert.equal(pieceSymbol(false, true), '\u25A0');
    // Black Pion (isBlack: true, isDame: false) -> '\u25CB'
    assert.equal(pieceSymbol(true, false), '\u25CB');
    // Black Dame (isBlack: true, isDame: true) -> '\u25A1'
    assert.equal(pieceSymbol(true, true), '\u25A1');
  });

  test('toStringPieceColor maps enum to names', () => {
    assert.equal(toStringPieceColor(PieceColor.WHITE), 'WHITE');
    assert.equal(toStringPieceColor(PieceColor.BLACK), 'BLACK');
    assert.throws(() => toStringPieceColor(3), RangeError);
  });

  test('toStringPieceType maps enum to names', () => {
    assert.equal(toStringPieceType(PieceType.PION), 'PION');
    assert.equal(toStringPieceType(PieceType.DAME), 'DAME');
    assert.throws(() => toStringPieceType(3), RangeError);
  });
});
