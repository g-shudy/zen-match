// src/engine/index.ts
var SPECIAL = {
  NONE: null,
  BOMB: "bomb",
  LINE: "line",
  RAINBOW: "rainbow"
};
var RNG = class {
  constructor(seed = Date.now()) {
    this.state = seed >>> 0;
  }
  next() {
    this.state = this.state * 1664525 + 1013904223 >>> 0;
    return this.state / 4294967296;
  }
  int(max) {
    return Math.floor(this.next() * max);
  }
};
function cloneBoard(board) {
  return board.map((row) => row.map((cell) => cell ? { ...cell } : null));
}
function serializeBoard(board) {
  return JSON.stringify(board);
}
function deserializeBoard(serialized) {
  return JSON.parse(serialized);
}
function boardToTypeString(board) {
  return board.map((row) => row.map((cell) => cell ? String(cell.type) : ".").join("")).join("\n");
}
function keyFor(r, c) {
  return `${r},${c}`;
}
function isSpecial(cell) {
  return !!cell?.special;
}
function isRainbow(cell) {
  return cell?.special === SPECIAL.RAINBOW;
}
function createEmptyBoard(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}
var Engine = class {
  constructor(config) {
    const rng = new RNG(config.seed ?? Date.now());
    this.state = {
      rows: config.rows,
      cols: config.cols,
      gemTypes: config.gemTypes,
      board: createEmptyBoard(config.rows, config.cols),
      rng,
      lastSwapPos: null
    };
  }
  reset(config = {}) {
    if (typeof config.rows === "number") this.state.rows = config.rows;
    if (typeof config.cols === "number") this.state.cols = config.cols;
    if (typeof config.gemTypes === "number") this.state.gemTypes = config.gemTypes;
    if (typeof config.seed === "number") this.state.rng = new RNG(config.seed);
    this.state.board = createEmptyBoard(this.state.rows, this.state.cols);
    this.state.lastSwapPos = null;
  }
  init() {
    const { rows, cols } = this.state;
    const board = createEmptyBoard(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = {
          type: this.randomGem(board, r, c),
          special: SPECIAL.NONE,
          direction: null
        };
      }
    }
    let attempts = 0;
    while (findMatches(board, rows, cols).length > 0 && attempts < 100) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          board[r][c] = {
            type: this.randomGem(board, r, c),
            special: SPECIAL.NONE,
            direction: null
          };
        }
      }
      attempts++;
    }
    this.state.board = board;
    return cloneBoard(board);
  }
  setBoard(board) {
    this.state.board = cloneBoard(board);
  }
  swap(pos1, pos2) {
    const { rows, cols } = this.state;
    const board = this.state.board;
    const frames = [];
    let pointsEarned = 0;
    let moveValid = false;
    if (!board[pos1.r]?.[pos1.c] || !board[pos2.r]?.[pos2.c]) {
      return { frames, pointsEarned, moveValid };
    }
    this.state.lastSwapPos = { r1: pos1.r, c1: pos1.c, r2: pos2.r, c2: pos2.c };
    const gem1 = board[pos1.r][pos1.c];
    const gem2 = board[pos2.r][pos2.c];
    const gem1Special = gem1?.special;
    const gem2Special = gem2?.special;
    [board[pos1.r][pos1.c], board[pos2.r][pos2.c]] = [board[pos2.r][pos2.c], board[pos1.r][pos1.c]];
    frames.push({ kind: "swap", board: cloneBoard(board) });
    const gem1IsSpecial = isSpecial(gem1);
    const gem2IsSpecial = isSpecial(gem2);
    const bothAreSpecial = gem1IsSpecial && gem2IsSpecial;
    if (bothAreSpecial) {
      const specials = [gem1Special, gem2Special];
      const isRainbowCombo = specials.includes(SPECIAL.RAINBOW);
      const isBombCombo = specials.every((s) => s === SPECIAL.BOMB);
      const isLineCombo = specials.every((s) => s === SPECIAL.LINE);
      const isBombLineCombo = specials.includes(SPECIAL.BOMB) && specials.includes(SPECIAL.LINE);
      const toRemove = /* @__PURE__ */ new Set();
      const animationClasses = /* @__PURE__ */ new Map();
      const effects = [];
      let points = 0;
      let chainReactionCount = 0;
      if (isRainbowCombo) {
        const gem1IsRainbow = gem1Special === SPECIAL.RAINBOW;
        const gem2IsRainbow = gem2Special === SPECIAL.RAINBOW;
        const otherSpecial = gem1IsRainbow ? gem2Special : gem1Special;
        if (gem1IsRainbow && gem2IsRainbow) {
          const color1 = gem1?.type ?? 0;
          const color2 = gem2?.type ?? 0;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (board[r][c] && (board[r][c]?.type === color1 || board[r][c]?.type === color2)) {
                toRemove.add(keyFor(r, c));
                animationClasses.set(keyFor(r, c), "rainbow-cleared");
              }
            }
          }
          toRemove.add(keyFor(pos1.r, pos1.c));
          toRemove.add(keyFor(pos2.r, pos2.c));
          animationClasses.set(keyFor(pos1.r, pos1.c), "rainbow-cleared");
          animationClasses.set(keyFor(pos2.r, pos2.c), "rainbow-cleared");
          points = 1e3 + toRemove.size * 15;
        } else if (otherSpecial === SPECIAL.BOMB) {
          const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
          const colorPositions = [];
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (board[r][c]?.type === targetType) {
                colorPositions.push({ r, c });
              }
            }
          }
          for (const pos of colorPositions) {
            effects.push({ kind: "explosion", r: pos.r, c: pos.c });
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const nr = pos.r + dr;
                const nc = pos.c + dc;
                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc]) {
                  const k = keyFor(nr, nc);
                  toRemove.add(k);
                  animationClasses.set(k, "exploding");
                }
              }
            }
          }
          const rainbowPos = gem1IsRainbow ? keyFor(pos2.r, pos2.c) : keyFor(pos1.r, pos1.c);
          toRemove.add(rainbowPos);
          animationClasses.set(rainbowPos, "rainbow-cleared");
          points = 2e3 + toRemove.size * 20;
        } else if (otherSpecial === SPECIAL.LINE) {
          const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
          const lineGem = gem1IsRainbow ? gem2 : gem1;
          const isVertical = lineGem?.direction === "vertical";
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (board[r][c]?.type === targetType) {
                if (isVertical) {
                  for (let i = 0; i < rows; i++) {
                    if (board[i][c]) {
                      const k = keyFor(i, c);
                      toRemove.add(k);
                      animationClasses.set(k, "line-cleared");
                    }
                  }
                  effects.push({ kind: "line", direction: "vertical", col: c });
                } else {
                  for (let i = 0; i < cols; i++) {
                    if (board[r][i]) {
                      const k = keyFor(r, i);
                      toRemove.add(k);
                      animationClasses.set(k, "line-cleared");
                    }
                  }
                  effects.push({ kind: "line", direction: "horizontal", row: r });
                }
              }
            }
          }
          const rainbowPos = gem1IsRainbow ? keyFor(pos2.r, pos2.c) : keyFor(pos1.r, pos1.c);
          toRemove.add(rainbowPos);
          animationClasses.set(rainbowPos, "rainbow-cleared");
          points = 2500 + toRemove.size * 20;
        } else {
          const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (board[r][c]?.type === targetType) {
                const k = keyFor(r, c);
                toRemove.add(k);
                animationClasses.set(k, "rainbow-cleared");
              }
            }
          }
          const rainbowPos = gem1IsRainbow ? keyFor(pos2.r, pos2.c) : keyFor(pos1.r, pos1.c);
          toRemove.add(rainbowPos);
          animationClasses.set(rainbowPos, "rainbow-cleared");
          points = 500 + toRemove.size * 10;
        }
      } else if (isBombCombo) {
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nr = pos1.r + dr;
            const nc = pos1.c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc]) {
              const k = keyFor(nr, nc);
              toRemove.add(k);
              animationClasses.set(k, "exploding");
            }
          }
        }
        effects.push({ kind: "explosion", r: pos1.r, c: pos1.c });
        points = 1e3 + toRemove.size * 15;
      } else if (isLineCombo) {
        for (let i = 0; i < cols; i++) {
          if (board[pos1.r][i]) {
            const k = keyFor(pos1.r, i);
            toRemove.add(k);
            animationClasses.set(k, "line-cleared");
          }
        }
        for (let i = 0; i < rows; i++) {
          if (board[i][pos1.c]) {
            const k = keyFor(i, pos1.c);
            toRemove.add(k);
            animationClasses.set(k, "line-cleared");
          }
        }
        effects.push({ kind: "line", direction: "horizontal", row: pos1.r });
        effects.push({ kind: "line", direction: "vertical", col: pos1.c });
        points = 800 + toRemove.size * 12;
      } else if (isBombLineCombo) {
        const lineGem = gem1Special === SPECIAL.LINE ? gem1 : gem2;
        const linePos = gem1Special === SPECIAL.LINE ? { r: pos2.r, c: pos2.c } : { r: pos1.r, c: pos1.c };
        if (lineGem?.direction === "vertical") {
          for (let dc = -1; dc <= 1; dc++) {
            const col = linePos.c + dc;
            if (col >= 0 && col < cols) {
              for (let i = 0; i < rows; i++) {
                if (board[i][col]) {
                  const k = keyFor(i, col);
                  toRemove.add(k);
                  animationClasses.set(k, "line-cleared");
                }
              }
              effects.push({ kind: "line", direction: "vertical", col });
            }
          }
        } else {
          for (let dr = -1; dr <= 1; dr++) {
            const row = linePos.r + dr;
            if (row >= 0 && row < rows) {
              for (let i = 0; i < cols; i++) {
                if (board[row][i]) {
                  const k = keyFor(row, i);
                  toRemove.add(k);
                  animationClasses.set(k, "line-cleared");
                }
              }
              effects.push({ kind: "line", direction: "horizontal", row });
            }
          }
        }
        points = 1200 + toRemove.size * 15;
      }
      const { bonusPoints, chainCount } = activateSpecialsInRemovalSet(
        board,
        toRemove,
        animationClasses,
        rows,
        cols,
        effects
      );
      chainReactionCount += chainCount;
      points += bonusPoints;
      pointsEarned += points;
      moveValid = true;
      frames.push({
        kind: "remove",
        positions: positionsFromSet(toRemove),
        animations: mapToRecord(animationClasses),
        effects,
        score: {
          points,
          combo: 1,
          breakdown: { base: points, matchBonus: 0, comboMultiplier: 1 },
          isBonus: true
        }
      });
      removePositions(board, toRemove);
      frames.push({ kind: "board", board: cloneBoard(board) });
      const dropped = dropGems(board, rows, cols);
      if (dropped) frames.push({ kind: "drop", board: cloneBoard(board) });
      const filled = fillGems(board, rows, cols, this.state.gemTypes, this.state.rng);
      if (filled) frames.push({ kind: "fill", board: cloneBoard(board) });
      const cascadeResult = processMatches(this.state, frames);
      pointsEarned += cascadeResult.points;
      if (!hasValidMoves(board, rows, cols)) {
        const shuffleResult = shuffleBoard(this.state, 0);
        frames.push(...shuffleResult.frames);
        pointsEarned += shuffleResult.points;
      }
    } else if (gem1Special === SPECIAL.RAINBOW || gem2Special === SPECIAL.RAINBOW) {
      const gem1IsRainbow = gem1Special === SPECIAL.RAINBOW;
      const targetType = gem1IsRainbow ? gem2?.type : gem1?.type;
      const rainbowPos = gem1IsRainbow ? pos2 : pos1;
      const toRemove = /* @__PURE__ */ new Set();
      const animationClasses = /* @__PURE__ */ new Map();
      const effects = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (board[r][c]?.type === targetType) {
            const k = keyFor(r, c);
            toRemove.add(k);
            animationClasses.set(k, "rainbow-cleared");
          }
        }
      }
      const rainbowKey = keyFor(rainbowPos.r, rainbowPos.c);
      toRemove.add(rainbowKey);
      animationClasses.set(rainbowKey, "rainbow-cleared");
      const processed = /* @__PURE__ */ new Set();
      processed.add(rainbowKey);
      const { bonusPoints, chainCount } = activateSpecialsInRemovalSet(
        board,
        toRemove,
        animationClasses,
        rows,
        cols,
        effects,
        processed
      );
      const points = 500 + toRemove.size * 10 + bonusPoints;
      pointsEarned += points;
      moveValid = true;
      frames.push({
        kind: "remove",
        positions: positionsFromSet(toRemove),
        animations: mapToRecord(animationClasses),
        effects,
        score: {
          points,
          combo: 1,
          breakdown: { base: points, matchBonus: 0, comboMultiplier: 1 },
          isBonus: true
        }
      });
      removePositions(board, toRemove);
      frames.push({ kind: "board", board: cloneBoard(board) });
      const dropped = dropGems(board, rows, cols);
      if (dropped) frames.push({ kind: "drop", board: cloneBoard(board) });
      const filled = fillGems(board, rows, cols, this.state.gemTypes, this.state.rng);
      if (filled) frames.push({ kind: "fill", board: cloneBoard(board) });
      const cascadeResult = processMatches(this.state, frames);
      pointsEarned += cascadeResult.points;
      if (!hasValidMoves(board, rows, cols)) {
        const sr = shuffleBoard(this.state, 0);
        frames.push(...sr.frames);
        pointsEarned += sr.points;
      }
    } else if (gem1IsSpecial || gem2IsSpecial) {
      const matches = findMatches(board, rows, cols);
      if (matches.length > 0) {
        const cascadeResult = processMatches(this.state, frames);
        pointsEarned += cascadeResult.points;
        moveValid = cascadeResult.points > 0;
        if (!hasValidMoves(board, rows, cols)) {
          const sr = shuffleBoard(this.state, 0);
          frames.push(...sr.frames);
          pointsEarned += sr.points;
        }
      } else {
        frames.push({ kind: "invalid", positions: [pos1, pos2] });
        [board[pos1.r][pos1.c], board[pos2.r][pos2.c]] = [board[pos2.r][pos2.c], board[pos1.r][pos1.c]];
        frames.push({ kind: "board", board: cloneBoard(board) });
      }
    } else {
      const matches = findMatches(board, rows, cols);
      if (matches.length === 0) {
        frames.push({ kind: "invalid", positions: [pos1, pos2] });
        [board[pos1.r][pos1.c], board[pos2.r][pos2.c]] = [board[pos2.r][pos2.c], board[pos1.r][pos1.c]];
        frames.push({ kind: "board", board: cloneBoard(board) });
      } else {
        const cascadeResult = processMatches(this.state, frames);
        pointsEarned += cascadeResult.points;
        moveValid = cascadeResult.points > 0;
        if (!hasValidMoves(board, rows, cols)) {
          const sr = shuffleBoard(this.state, 0);
          frames.push(...sr.frames);
          pointsEarned += sr.points;
        }
      }
    }
    this.state.lastSwapPos = null;
    return { frames, pointsEarned, moveValid };
  }
  hasValidMoves() {
    return hasValidMoves(this.state.board, this.state.rows, this.state.cols);
  }
  findValidMove() {
    return findValidMove(this.state.board, this.state.rows, this.state.cols);
  }
  randomGem(board, r, c) {
    let type = 0;
    let attempts = 0;
    do {
      type = this.state.rng.int(this.state.gemTypes);
      attempts++;
    } while (attempts < 50 && (c >= 2 && board[r][c - 1]?.type === type && board[r][c - 2]?.type === type || r >= 2 && board[r - 1]?.[c]?.type === type && board[r - 2]?.[c]?.type === type));
    return type;
  }
};
function positionsFromSet(toRemove) {
  return Array.from(toRemove).map((key) => {
    const [r, c] = key.split(",").map(Number);
    return { r, c };
  });
}
function mapToRecord(map) {
  const record = {};
  for (const [key, value] of map.entries()) {
    record[key] = value;
  }
  return record;
}
function removePositions(board, toRemove) {
  for (const key of toRemove) {
    const [r, c] = key.split(",").map(Number);
    board[r][c] = null;
  }
}
function findMatches(board, rows, cols) {
  const matchedCells = /* @__PURE__ */ new Map();
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (!board[r][c]) {
        c++;
        continue;
      }
      const type = board[r][c].type;
      let endC = c + 1;
      while (endC < cols && board[r][endC]?.type === type) {
        endC++;
      }
      const len = endC - c;
      if (len >= 3) {
        for (let i = c; i < endC; i++) {
          const key = keyFor(r, i);
          if (!matchedCells.has(key)) {
            matchedCells.set(key, { r, c: i, type, matchLen: len, direction: "horizontal" });
          } else {
            const existing = matchedCells.get(key);
            existing.matchLen = Math.max(existing.matchLen, len);
            existing.isComplex = true;
          }
        }
      }
      c = endC;
    }
  }
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (!board[r][c]) {
        r++;
        continue;
      }
      const type = board[r][c].type;
      let endR = r + 1;
      while (endR < rows && board[endR][c]?.type === type) {
        endR++;
      }
      const len = endR - r;
      if (len >= 3) {
        for (let i = r; i < endR; i++) {
          const key = keyFor(i, c);
          if (!matchedCells.has(key)) {
            matchedCells.set(key, { r: i, c, type, matchLen: len, direction: "vertical" });
          } else {
            const existing = matchedCells.get(key);
            existing.matchLen += len;
            existing.isComplex = true;
          }
        }
      }
      r = endR;
    }
  }
  if (matchedCells.size === 0) return [];
  const matches = [];
  const visited = /* @__PURE__ */ new Set();
  for (const [key, data] of matchedCells) {
    if (visited.has(key)) continue;
    const match = [];
    const queue = [key];
    let hasComplex = false;
    let hDir = false;
    let vDir = false;
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      const cellData = matchedCells.get(current);
      if (!cellData) continue;
      match.push({ r: cellData.r, c: cellData.c });
      if (cellData.isComplex) hasComplex = true;
      if (cellData.direction === "horizontal") hDir = true;
      if (cellData.direction === "vertical") vDir = true;
      const [cr, cc] = current.split(",").map(Number);
      const neighbors = [
        keyFor(cr - 1, cc),
        keyFor(cr + 1, cc),
        keyFor(cr, cc - 1),
        keyFor(cr, cc + 1)
      ];
      for (const neighbor of neighbors) {
        if (matchedCells.has(neighbor) && !visited.has(neighbor)) {
          const neighborData = matchedCells.get(neighbor);
          if (neighborData.type === cellData.type) {
            queue.push(neighbor);
          }
        }
      }
    }
    matches.push({
      positions: match,
      effectiveLen: match.length,
      isComplex: hasComplex,
      direction: hDir && vDir ? "both" : hDir ? "horizontal" : "vertical",
      type: data.type
    });
  }
  return matches;
}
function activateSpecialsInRemovalSet(board, toRemove, animationClasses, rows, cols, effects, processed = /* @__PURE__ */ new Set()) {
  let bonusPoints = 0;
  let chainCount = 0;
  let newSpecialsFound = true;
  let iterations = 0;
  const maxIterations = 20;
  const subSteps = [];
  while (newSpecialsFound && iterations < maxIterations) {
    newSpecialsFound = false;
    iterations++;
    const currentToRemove = new Set(toRemove);
    for (const key of currentToRemove) {
      const [r, c] = key.split(",").map(Number);
      const gem = board[r]?.[c];
      if (!gem || !gem.special) continue;
      if (processed.has(key)) continue;
      processed.add(key);
      const stepPositions = [];
      const stepAnimations = {};
      const stepEffects = [];
      if (gem.special === SPECIAL.BOMB) {
        chainCount++;
        stepEffects.push({ kind: "explosion", r, c });
        effects.push({ kind: "explosion", r, c });
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
              const newKey = keyFor(nr, nc);
              if (!toRemove.has(newKey)) {
                toRemove.add(newKey);
                animationClasses.set(newKey, "exploding");
                stepPositions.push({ r: nr, c: nc });
                stepAnimations[newKey] = "exploding";
                newSpecialsFound = true;
              }
            }
          }
        }
        animationClasses.set(key, "exploding");
        bonusPoints += 150;
      } else if (gem.special === SPECIAL.LINE) {
        chainCount++;
        const dir = gem.direction || "horizontal";
        if (dir === "horizontal" || dir === "cross") {
          for (let i = 0; i < cols; i++) {
            const newKey = keyFor(r, i);
            if (!toRemove.has(newKey)) {
              toRemove.add(newKey);
              animationClasses.set(newKey, "line-cleared");
              stepPositions.push({ r, c: i });
              stepAnimations[newKey] = "line-cleared";
              newSpecialsFound = true;
            }
          }
          stepEffects.push({ kind: "line", direction: "horizontal", row: r });
          effects.push({ kind: "line", direction: "horizontal", row: r });
        }
        if (dir === "vertical" || dir === "cross") {
          for (let i = 0; i < rows; i++) {
            const newKey = keyFor(i, c);
            if (!toRemove.has(newKey)) {
              toRemove.add(newKey);
              animationClasses.set(newKey, "line-cleared");
              stepPositions.push({ r: i, c });
              stepAnimations[newKey] = "line-cleared";
              newSpecialsFound = true;
            }
          }
          stepEffects.push({ kind: "line", direction: "vertical", col: c });
          effects.push({ kind: "line", direction: "vertical", col: c });
        }
        animationClasses.set(key, "line-cleared");
        bonusPoints += 200;
      } else if (gem.special === SPECIAL.RAINBOW) {
        chainCount++;
        const targetType = gem.type;
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            if (board[i][j]?.type === targetType) {
              const newKey = keyFor(i, j);
              if (!toRemove.has(newKey)) {
                toRemove.add(newKey);
                animationClasses.set(newKey, "rainbow-cleared");
                stepPositions.push({ r: i, c: j });
                stepAnimations[newKey] = "rainbow-cleared";
                newSpecialsFound = true;
              }
            }
          }
        }
        animationClasses.set(key, "rainbow-cleared");
        bonusPoints += 500;
      }
      if (stepPositions.length > 0) {
        subSteps.push({
          triggerPos: { r, c },
          positions: stepPositions,
          animations: stepAnimations,
          effects: stepEffects
        });
      }
    }
  }
  return { bonusPoints, chainCount, subSteps };
}
function findBestSpecialPosition(match, lastSwapPos, comboCount = 1) {
  if (comboCount <= 1 && lastSwapPos) {
    for (const pos of match.positions) {
      if (pos.r === lastSwapPos.r1 && pos.c === lastSwapPos.c1 || pos.r === lastSwapPos.r2 && pos.c === lastSwapPos.c2) {
        return pos;
      }
    }
  }
  const centroidR = match.positions.reduce((sum, p) => sum + p.r, 0) / match.positions.length;
  const centroidC = match.positions.reduce((sum, p) => sum + p.c, 0) / match.positions.length;
  let bestPos = match.positions[0];
  let bestDist = Infinity;
  for (const pos of match.positions) {
    const dist = Math.hypot(pos.r - centroidR, pos.c - centroidC);
    if (dist < bestDist) {
      bestDist = dist;
      bestPos = pos;
    }
  }
  return bestPos;
}
function processMatches(state, frames) {
  const { rows, cols, board } = state;
  let matches = findMatches(board, rows, cols);
  let totalPoints = 0;
  let comboCount = 0;
  while (matches.length > 0) {
    comboCount++;
    const toRemove = /* @__PURE__ */ new Set();
    const specials = [];
    let matchBonus = 0;
    const animationClasses = /* @__PURE__ */ new Map();
    const effects = [];
    for (const match of matches) {
      const len = match.effectiveLen || match.positions.length;
      const type = match.type;
      if (len >= 6) {
        const pos = findBestSpecialPosition(match, state.lastSwapPos, comboCount);
        specials.push({ pos, type, special: SPECIAL.RAINBOW });
        matchBonus += 200;
      } else if (match.isComplex && len >= 5) {
        const pos = findBestSpecialPosition(match, state.lastSwapPos, comboCount);
        specials.push({ pos, type, special: SPECIAL.BOMB });
        matchBonus += 150;
      } else if (len === 5) {
        const pos = findBestSpecialPosition(match, state.lastSwapPos, comboCount);
        const clearDir = match.direction === "horizontal" ? "horizontal" : "vertical";
        specials.push({ pos, type, special: SPECIAL.LINE, direction: clearDir });
        matchBonus += 100;
      } else if (len === 4) {
        const pos = findBestSpecialPosition(match, state.lastSwapPos, comboCount);
        specials.push({ pos, type, special: SPECIAL.BOMB });
        matchBonus += 50;
      }
      if (len > 3) {
        matchBonus += Math.pow(len - 3, 2) * 20;
      }
      for (const pos of match.positions) {
        toRemove.add(keyFor(pos.r, pos.c));
      }
    }
    const { bonusPoints, chainCount, subSteps } = activateSpecialsInRemovalSet(
      board,
      toRemove,
      animationClasses,
      rows,
      cols,
      effects
    );
    matchBonus += bonusPoints;
    const basePoints = toRemove.size * 10;
    const comboMultiplier = 1 + (comboCount - 1) * 0.5;
    const points = Math.floor((basePoints + matchBonus) * comboMultiplier);
    totalPoints += points;
    frames.push({
      kind: "remove",
      positions: positionsFromSet(toRemove),
      animations: mapToRecord(animationClasses),
      effects,
      score: {
        points,
        combo: comboCount,
        breakdown: { base: basePoints, matchBonus, comboMultiplier },
        isBonus: matchBonus > 50
      },
      subSteps: subSteps.length > 0 ? subSteps : void 0
    });
    removePositions(board, toRemove);
    const specialPriority = { [SPECIAL.RAINBOW]: 3, [SPECIAL.LINE]: 2, [SPECIAL.BOMB]: 1 };
    specials.sort((a, b) => (specialPriority[b.special ?? ""] ?? 0) - (specialPriority[a.special ?? ""] ?? 0));
    const usedPositions = /* @__PURE__ */ new Set();
    const newSpecialPositions = [];
    for (const sp of specials) {
      const posKey = keyFor(sp.pos.r, sp.pos.c);
      if (usedPositions.has(posKey)) continue;
      if (!board[sp.pos.r][sp.pos.c]) {
        board[sp.pos.r][sp.pos.c] = {
          type: sp.type,
          special: sp.special,
          direction: sp.direction ?? null
        };
        usedPositions.add(posKey);
        newSpecialPositions.push(sp.pos);
      }
    }
    frames.push({ kind: "board", board: cloneBoard(board), newSpecials: newSpecialPositions.length > 0 ? newSpecialPositions : void 0 });
    const dropped = dropGems(board, rows, cols);
    if (dropped) frames.push({ kind: "drop", board: cloneBoard(board) });
    const filled = fillGems(board, rows, cols, state.gemTypes, state.rng);
    if (filled) frames.push({ kind: "fill", board: cloneBoard(board) });
    matches = findMatches(board, rows, cols);
    if (matches.length > 0) {
      const pendingPositions = [];
      for (const match of matches) {
        for (const pos of match.positions) {
          pendingPositions.push(pos);
        }
      }
      frames.push({ kind: "preview", board: cloneBoard(board), pendingPositions });
    }
  }
  return { points: totalPoints };
}
function dropGems(board, rows, cols) {
  let dropped = false;
  for (let c = 0; c < cols; c++) {
    let writePos = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      if (board[r][c]) {
        if (writePos !== r) {
          board[writePos][c] = board[r][c];
          board[r][c] = null;
          dropped = true;
        }
        writePos--;
      }
    }
  }
  return dropped;
}
function fillGems(board, rows, cols, gemTypes, rng) {
  let filled = false;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (!board[r][c]) {
        board[r][c] = {
          type: rng.int(gemTypes),
          special: SPECIAL.NONE,
          direction: null
        };
        filled = true;
      }
    }
  }
  return filled;
}
function hasValidMoves(board, rows, cols) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1 && board[r][c] && board[r][c + 1]) {
        if (isMoveValid(board, rows, cols, r, c, r, c + 1)) return true;
      }
      if (r < rows - 1 && board[r][c] && board[r + 1][c]) {
        if (isMoveValid(board, rows, cols, r, c, r + 1, c)) return true;
      }
    }
  }
  return false;
}
function findValidMove(board, rows, cols) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c < cols - 1 && board[r][c] && board[r][c + 1]) {
        if (isMoveValid(board, rows, cols, r, c, r, c + 1)) {
          return { r1: r, c1: c, r2: r, c2: c + 1 };
        }
      }
      if (r < rows - 1 && board[r][c] && board[r + 1][c]) {
        if (isMoveValid(board, rows, cols, r, c, r + 1, c)) {
          return { r1: r, c1: c, r2: r + 1, c2: c };
        }
      }
    }
  }
  return null;
}
function isMoveValid(board, rows, cols, r1, c1, r2, c2) {
  const gem1 = board[r1][c1];
  const gem2 = board[r2][c2];
  if (!gem1 || !gem2) return false;
  if (isSpecial(gem1) && isSpecial(gem2)) return true;
  if (isRainbow(gem1) || isRainbow(gem2)) return true;
  [board[r1][c1], board[r2][c2]] = [board[r2][c2], board[r1][c1]];
  const hasMatch = findMatches(board, rows, cols).length > 0;
  [board[r1][c1], board[r2][c2]] = [board[r2][c2], board[r1][c1]];
  return hasMatch;
}
function shuffleBoard(state, attempts) {
  const frames = [];
  let shufflePoints = 0;
  const MAX_SHUFFLE_ATTEMPTS = 10;
  const MAX_VISUAL_ATTEMPTS = 3;
  const { rows, cols, board } = state;
  const oldPositions = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c]) oldPositions.push({ from: { r, c }, type: board[r][c].type });
    }
  }
  const gems = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c]) gems.push(board[r][c]);
    }
  }
  for (let i = gems.length - 1; i > 0; i--) {
    const j = state.rng.int(i + 1);
    [gems[i], gems[j]] = [gems[j], gems[i]];
  }
  let idx = 0;
  const moves = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      board[r][c] = gems[idx];
      if (oldPositions[idx]) {
        moves.push({ from: oldPositions[idx].from, to: { r, c }, type: gems[idx].type });
      }
      idx++;
    }
  }
  if (attempts < MAX_VISUAL_ATTEMPTS) {
    frames.push({ kind: "shuffle", board: cloneBoard(board), attempt: attempts, moves });
  }
  if (findMatches(board, rows, cols).length > 0) {
    const cascadeResult = processMatches(state, frames);
    shufflePoints += cascadeResult.points;
  }
  if (!hasValidMoves(board, rows, cols) && attempts < MAX_SHUFFLE_ATTEMPTS) {
    const result = shuffleBoard(state, attempts + 1);
    frames.push(...result.frames);
    shufflePoints += result.points;
  } else if (!hasValidMoves(board, rows, cols)) {
    regenerateBoard(state);
    frames.push({ kind: "shuffle", board: cloneBoard(state.board), attempt: attempts + 1 });
  }
  return { frames, points: shufflePoints };
}
function regenerateBoard(state) {
  const { rows, cols, gemTypes, rng } = state;
  const savedSpecials = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = state.board[r][c];
      if (cell && cell.special) {
        savedSpecials.push({ ...cell });
      }
    }
  }
  const board = createEmptyBoard(rows, cols);
  const randomGem = (r, c) => {
    let type = 0;
    let attempts2 = 0;
    do {
      type = rng.int(gemTypes);
      attempts2++;
    } while (attempts2 < 50 && (c >= 2 && board[r][c - 1]?.type === type && board[r][c - 2]?.type === type || r >= 2 && board[r - 1]?.[c]?.type === type && board[r - 2]?.[c]?.type === type));
    return type;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      board[r][c] = {
        type: randomGem(r, c),
        special: SPECIAL.NONE,
        direction: null
      };
    }
  }
  let attempts = 0;
  while (findMatches(board, rows, cols).length > 0 && attempts < 100) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        board[r][c] = {
          type: randomGem(r, c),
          special: SPECIAL.NONE,
          direction: null
        };
      }
    }
    attempts++;
  }
  for (const special of savedSpecials) {
    const r = rng.int(rows);
    const c = rng.int(cols);
    if (board[r][c]) {
      board[r][c] = special;
    }
  }
  state.board = board;
  state.lastSwapPos = null;
}
export {
  Engine,
  RNG,
  SPECIAL,
  boardToTypeString,
  cloneBoard,
  deserializeBoard,
  findMatches,
  findValidMove,
  hasValidMoves,
  serializeBoard
};
//# sourceMappingURL=engine.js.map
