/**
 * compareCoords.js — compare les coordonnées natives calculées avec un échantillon de référence.
 *
 * À charger APRÈS svg2gcode.js :
 *     <script src="svg2gcode.js"></script>
 *     <script src="compareCoords.js"></script>
 *
 * Deux usages :
 *
 * 1) Échantillon de POINTS  (x, y cartésiens → A, B attendus)
 *      var s   = CompareCoords.parseSamplePoints(texte);        // lignes « x y A B » (espaces, , ou ;)
 *      var res = CompareCoords.diagnoseSample(s, Parameters);   // teste ~60 hypothèses, classe les meilleures
 *      console.log(CompareCoords.formatReport(res));
 *      // puis, une fois la bonne hypothèse identifiée :
 *      var cmp = CompareCoords.compareSamplePoints(s, Parameters, res.best.config);
 *      console.table(cmp.rows);
 *
 * 2) Échantillon de G-CODE  (fichier de référence vs fichier généré)
 *      var cmp = CompareCoords.compareGcode(gcodeReference, gcodeGenere, { tolerance: 1 });
 *      console.log(CompareCoords.formatReport(cmp));
 *
 * 3) PLACEMENT (offset + zoom) déduit d'un G-code de référence
 *      var fit = CompareCoords.fitPlacement(gcodeReference, svgTexte, Parameters);
 *      console.log(CompareCoords.formatReport(fit));
 *      // → svg2gcode(svgTexte, { scale: fit.recommended.scale, offsetX: …, offsetY: … }, Parameters)
 *
 * Dans les stats, `scaleFitA/B` est le rapport moyen calculé/attendu (≈ 1 si tout va bien ;
 * 0,9375 = confusion 90/96 dpi ; 2,105 = confusion pas/mm ; 3,78 = confusion px/mm …) et
 * `biasA/B` le décalage moyen signé (calculé − attendu).
 */
(function (root) {
    var core = (typeof module !== 'undefined' && module.exports) ? require('./svg2gcode.js') : root;


    /* ---------------------------------------------------------- */
    /*  Lecture des échantillons                                   */
    /* ---------------------------------------------------------- */

    /** Lignes « x y A B ». Séparateurs : espace, tab, virgule, ou point-virgule (virgule décimale OK). */
    function parseSamplePoints(text) {
        var rows = [];
        String(text).split(/\r?\n/).forEach(function (line, i) {
            line = line.replace(/(#|\/\/).*$/, '').trim();
            if (!line) return;
            var tokens = (line.indexOf(';') >= 0)
                ? line.split(';').map(function (s) { return s.trim().replace(',', '.'); })
                : line.split(/[\s,]+/);
            var t = tokens.filter(function (s) { return s !== ''; }).map(Number);
            if (t.length >= 4 && t.slice(0, 4).every(function (v) { return isFinite(v); })) {
                rows.push({ x: t[0], y: t[1], a: t[2], b: t[3], line: i + 1 });
            }                                                  // sinon : en-tête, ignoré
        });
        return rows;
    }

    /** Extrait les déplacements C01 / C09 / C17 d'un G-code Polargraph. */
    function parseGcodeMoves(text) {
        var moves = [], penDown = false;
        String(text).split(/\r?\n/).forEach(function (line, i) {
            var m = /^\s*(C01|C09|C17)\s*,\s*([-+]?[\d.]+)\s*,\s*([-+]?[\d.]+)/i.exec(line);
            if (m) {
                moves.push({ cmd: m[1].toUpperCase(), a: parseFloat(m[2]), b: parseFloat(m[3]), line: i + 1,
                             penDown: penDown, penDownAfter: false });
            } else if (/^\s*C13\b/i.test(line)) {                // C13 = stylo posé
                penDown = true;
                if (moves.length) moves[moves.length - 1].penDownAfter = true;
            } else if (/^\s*C14\b/i.test(line)) {                // C14 = stylo levé
                penDown = false;
            }
        });
        return moves;
    }


    /* ---------------------------------------------------------- */
    /*  Statistiques                                               */
    /* ---------------------------------------------------------- */

    function computeStats(rows, tol) {
        var n = rows.length, maxAbs = 0, sumAbs = 0, sumSq = 0, biasA = 0, biasB = 0, ok = 0;
        var sCE_A = 0, sEE_A = 0, sCE_B = 0, sEE_B = 0;
        rows.forEach(function (r) {
            var m = Math.max(Math.abs(r.dA), Math.abs(r.dB));
            maxAbs = Math.max(maxAbs, m);
            sumAbs += Math.abs(r.dA) + Math.abs(r.dB);
            sumSq += r.dA * r.dA + r.dB * r.dB;
            biasA += r.dA; biasB += r.dB;
            if (m <= tol) ok++;
            sCE_A += r.calcA * r.expA; sEE_A += r.expA * r.expA;
            sCE_B += r.calcB * r.expB; sEE_B += r.expB * r.expB;
        });
        return {
            n: n, tolerance: tol,
            maxAbs: maxAbs,
            meanAbs: n ? sumAbs / (2 * n) : NaN,
            rms: n ? Math.sqrt(sumSq / (2 * n)) : NaN,
            biasA: n ? biasA / n : NaN, biasB: n ? biasB / n : NaN,
            withinTol: ok, pctWithinTol: n ? 100 * ok / n : NaN,
            scaleFitA: sEE_A ? sCE_A / sEE_A : NaN, scaleFitB: sEE_B ? sCE_B / sEE_B : NaN
        };
    }

    function buildConfig(params, c) {
        var machine = core.resolveMachine(params, { applyMicrostepping: !!c.applyMicrostepping });
        return {
            widthMM: machine.widthMM, stepsPerMM: machine.stepsPerMM,
            inputUnit: c.inputUnit || 'mm', outputUnit: c.outputUnit || 'steps',
            rounding: c.rounding || 'round', quantize: c.quantize || 'all',
            applyMicrostepping: !!c.applyMicrostepping
        };
    }


    /* ---------------------------------------------------------- */
    /*  1) Échantillon de points                                   */
    /* ---------------------------------------------------------- */

    /**
     * opts = { inputUnit:'mm'|'px'|'steps', outputUnit:'steps'|'mm', rounding, quantize,
     *          applyMicrostepping, tolerance }
     * `tolerance` est exprimée dans l'unité de sortie (défaut : 1 pas, ou 0,5 mm).
     */
    function compareSamplePoints(samples, params, opts) {
        opts = opts || {};
        var cfg = buildConfig(params, opts);
        var tol = (opts.tolerance !== undefined) ? opts.tolerance : (cfg.outputUnit === 'steps' ? 1 : 0.5);
        var rows = samples.map(function (s) {
            var n = core.polargraphNative(s.x, s.y, cfg) || { a: NaN, b: NaN };
            var r = { x: s.x, y: s.y, expA: s.a, expB: s.b, calcA: n.a, calcB: n.b };
            r.dA = n.a - s.a;
            r.dB = n.b - s.b;
            r.ok = Math.max(Math.abs(r.dA), Math.abs(r.dB)) <= tol;
            return r;
        });
        return { type: 'points', config: cfg, rows: rows, stats: computeStats(rows, tol) };
    }

    /** Largeur machine (mm) déduite de l'échantillon : W = x ± √(B² − y²). */
    function estimateMachineWidth(samples, params, cfg) {
        var spmm = cfg.stepsPerMM;
        var inToMM = cfg.inputUnit === 'px' ? core.PX_TO_MM : (cfg.inputUnit === 'steps' ? 1 / spmm : 1);
        var outToMM = cfg.outputUnit === 'steps' ? 1 / spmm : 1;
        var declared = core.resolveMachine(params).widthMM, est = [];
        samples.forEach(function (s) {
            var x = s.x * inToMM, y = s.y * inToMM, b = s.b * outToMM;
            var d = b * b - y * y;
            if (d < 0) return;
            var r = Math.sqrt(d), w1 = x + r, w2 = x - r;
            est.push(Math.abs(w1 - declared) <= Math.abs(w2 - declared) ? w1 : w2);
        });
        if (!est.length) return null;
        est.sort(function (p, q) { return p - q; });
        return { declaredMM: declared, medianMM: est[Math.floor(est.length / 2)],
                 minMM: est[0], maxMM: est[est.length - 1], n: est.length };
    }

    /** Teste toutes les hypothèses plausibles et les classe (erreur max, puis RMS). */
    function diagnoseSample(samples, params, opts) {
        opts = opts || {};
        var machine = core.resolveMachine(params);
        var microOptions = machine.microstepping > 1 ? [false, true] : [false];
        var results = [];

        ['mm', 'px', 'steps'].forEach(function (inputUnit) {
            ['steps', 'mm'].forEach(function (outputUnit) {
                ['round', 'trunc', 'none'].forEach(function (rounding) {
                    var quantizes = (outputUnit === 'steps') ? ['width', 'all', 'none'] : ['none'];
                    var micros = (outputUnit === 'steps' || inputUnit === 'steps') ? microOptions : [false];
                    quantizes.forEach(function (quantize) {
                        micros.forEach(function (applyMicrostepping) {
                            var c = { inputUnit: inputUnit, outputUnit: outputUnit, rounding: rounding,
                                      quantize: quantize, applyMicrostepping: applyMicrostepping };
                            var r = compareSamplePoints(samples, params, {
                                inputUnit: inputUnit, outputUnit: outputUnit, rounding: rounding,
                                quantize: quantize, applyMicrostepping: applyMicrostepping,
                                tolerance: opts.tolerance
                            });
                            if (isFinite(r.stats.maxAbs)) {
                                results.push({ label: describeConfig(c), config: c, stats: r.stats });
                            }
                        });
                    });
                });
            });
        });

        results.sort(function (p, q) {
            return (p.stats.maxAbs - q.stats.maxAbs) || (p.stats.rms - q.stats.rms);
        });
        var best = results[0] || null;
        return {
            type: 'diagnosis', n: samples.length, ranking: results.slice(0, 8), best: best,
            widthEstimate: best ? estimateMachineWidth(samples, params, buildConfig(params, best.config)) : null
        };
    }

    function describeConfig(c) {
        var s = 'entrée ' + c.inputUnit + ' → sortie ' + c.outputUnit;
        if (c.outputUnit === 'steps') s += ', quantize=' + c.quantize;
        s += ', arrondi=' + c.rounding;
        if (c.applyMicrostepping) s += ', ×microstepping';
        return s;
    }


    /* ---------------------------------------------------------- */
    /*  2) Échantillon de G-code                                   */
    /* ---------------------------------------------------------- */

    /**
     * Compare deux G-code déplacement par déplacement (dans l'ordre), C01/C17 uniquement
     * (les C09 sont ignorés, sauf opts.includeC09). Les déplacements en trop d'un côté (retour au home
     * final, par exemple) ne sont pas comparés : seuls les min(n) premiers le sont.
     * Retourne aussi `firstMismatch` : le premier déplacement hors tolérance.
     */
    function compareGcode(expectedText, actualText, opts) {
        opts = opts || {};
        var tol = (opts.tolerance !== undefined) ? opts.tolerance : 1;
        // C09 = « déclarer la position courante » : ce n'est pas un déplacement, on l'ignore sauf demande
        // explicite (opts.includeC09), pour qu'un C09 de départ présent d'un seul côté ne décale pas tout.
        var keep = function (m) { return opts.includeC09 || m.cmd !== 'C09'; };
        var e = parseGcodeMoves(expectedText).filter(keep), a = parseGcodeMoves(actualText).filter(keep);
        var n = Math.min(e.length, a.length), rows = [], firstMismatch = null;
        for (var i = 0; i < n; i++) {
            var r = { i: i, cmdExp: e[i].cmd, cmdAct: a[i].cmd, lineExp: e[i].line, lineAct: a[i].line,
                      expA: e[i].a, expB: e[i].b, calcA: a[i].a, calcB: a[i].b };
            r.dA = r.calcA - r.expA;
            r.dB = r.calcB - r.expB;
            r.ok = Math.max(Math.abs(r.dA), Math.abs(r.dB)) <= tol;
            if (!r.ok && !firstMismatch) firstMismatch = r;
            rows.push(r);
        }
        return { type: 'gcode', countExpected: e.length, countActual: a.length, firstMismatch: firstMismatch,
                 rows: rows, stats: computeStats(rows, tol) };
    }


    /* ---------------------------------------------------------- */
    /*  3) Placement (offset + zoom) déduit d'une référence        */
    /* ---------------------------------------------------------- */

    /** Points du SVG en mm « bruts » : (unités utilisateur − origine viewBox) × mm/unité, sans offset ni zoom. */
    function svgPointsMM(svgText) {
        var reader = (typeof SVGReader !== 'undefined') ? SVGReader : root.SVGReader;
        if (!reader) throw new Error('SVGReader.js doit être chargé');
        var doc = core.svgDocumentInfo(svgText);
        var parsed = reader.parse(String(svgText).replace(/^[\n\r \t]/gm, ''), {});
        var out = [];
        (parsed.allcolors || []).forEach(function (path) {
            var pts = [], prev = null;
            for (var i = 0; i < path.length; i++) {
                var p = { x: (path[i].x - doc.minX) * doc.unitToMM, y: (path[i].y - doc.minY) * doc.unitToMM };
                if (prev && p.x === prev.x && p.y === prev.y) continue;
                pts.push(p); prev = p;
            }
            if (pts.length >= 2) for (var j = 0; j < pts.length; j++) out.push(pts[j]);
        });
        return out;
    }

    /** Déplacements C01/C17 du G-code de référence, ramenés en positions cartésiennes (mm). */
    function referenceCartesianMM(gcodeText, params, opts) {
        var machine = core.resolveMachine(params, { applyMicrostepping: !!opts.applyMicrostepping });
        var inSteps = (opts.unit || 'steps') === 'steps', spmm = machine.stepsPerMM;
        var W = inSteps ? ((opts.quantize === 'none') ? machine.widthMM * spmm : core.inSteps(machine.widthMM, spmm))
                        : machine.widthMM;
        var moves = parseGcodeMoves(gcodeText).filter(function (m) { return m.cmd !== 'C09'; });
        // Si la référence contient des C13 : on ne garde que les points dessinés (stylo posé) et le déplacement
        // qui amène au premier point ; on écarte retour au home et autres déplacements stylo levé.
        if (moves.some(function (m) { return m.penDown || m.penDownAfter; })) {
            moves = moves.filter(function (m) { return m.penDown || m.penDownAfter; });
        }
        return moves.map(function (m) {
            var c = core.calculateCartesianCoords(m.a, m.b, W, false);
            return inSteps ? { x: c.x / spmm, y: c.y / spmm } : c;
        });
    }

    function mean(a) { var t = 0; a.forEach(function (v) { t += v; }); return t / a.length; }

    /** Zoom uniforme s et translation (tx, ty) minimisant Σ|ref − (s·svg + t)|². */
    function similarityFit(svg, ref) {
        var mux = mean(svg.map(function (p) { return p.x; })), muy = mean(svg.map(function (p) { return p.y; }));
        var mvx = mean(ref.map(function (p) { return p.x; })), mvy = mean(ref.map(function (p) { return p.y; }));
        var num = 0, den = 0, nx = 0, dx = 0, ny = 0, dy = 0;
        for (var i = 0; i < svg.length; i++) {
            var ux = svg[i].x - mux, uy = svg[i].y - muy, vx = ref[i].x - mvx, vy = ref[i].y - mvy;
            num += ux * vx + uy * vy; den += ux * ux + uy * uy;
            nx += ux * vx; dx += ux * ux; ny += uy * vy; dy += uy * uy;
        }
        var sc = den ? num / den : NaN, sumSq = 0, max = 0;
        var tx = mvx - sc * mux, ty = mvy - sc * muy;
        for (var k = 0; k < svg.length; k++) {
            var e = Math.hypot(ref[k].x - (sc * svg[k].x + tx), ref[k].y - (sc * svg[k].y + ty));
            sumSq += e * e; if (e > max) max = e;
        }
        var sx = dx ? nx / dx : NaN, sy = dy ? ny / dy : NaN;
        return { scale: sc, offsetX: tx, offsetY: ty, rms: Math.sqrt(sumSq / svg.length), max: max,
                 perAxis: { sx: sx, sy: sy, tx: mvx - sx * mux, ty: mvy - sy * muy } };
    }

    function bboxOf(pts) {
        var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        pts.forEach(function (p) {
            b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
            b.minY = Math.min(b.minY, p.y); b.maxY = Math.max(b.maxY, p.y);
        });
        return b;
    }

    /**
     * Déduit le zoom (`scale`) et l'origine (`offsetX`, `offsetY`, en mm) qui font coïncider le SVG
     * avec un G-code de référence. Méthode 1 : appariement point à point (la référence peut commencer
     * par 0 à 3 déplacements supplémentaires). Méthode 2 (secours) : comparaison des boîtes englobantes.
     * opts : { unit:'steps'|'mm', quantize, applyMicrostepping }
     */
    function fitPlacement(referenceGcode, svgText, params, opts) {
        opts = opts || {};
        var svgPts = svgPointsMM(svgText);
        var refPts = referenceCartesianMM(referenceGcode, params, opts);
        if (svgPts.length < 3 || refPts.length < 3) throw new Error('Pas assez de points (SVG ' + svgPts.length + ', référence ' + refPts.length + ')');

        var best = null;
        for (var k = 0; k <= 3; k++) {
            var n = Math.min(svgPts.length, refPts.length - k);
            if (n < 3) break;
            var fit = similarityFit(svgPts.slice(0, n), refPts.slice(k, k + n));
            if (isFinite(fit.rms) && (!best || fit.rms < best.fit.rms)) best = { k: k, n: n, fit: fit };
        }
        var bs = bboxOf(svgPts), br = bboxOf(refPts);
        var bsx = (br.maxX - br.minX) / (bs.maxX - bs.minX), bsy = (br.maxY - br.minY) / (bs.maxY - bs.minY);
        var bbox = { scale: bsx, scaleY: bsy, offsetX: br.minX - bsx * bs.minX, offsetY: br.minY - bsy * bs.minY };
        var aligned = !!best && best.fit.max < 3;                       // 3 mm ≈ 6 pas
        return {
            type: 'placement', countSvg: svgPts.length, countReference: refPts.length,
            shift: best ? best.k : null, n: best ? best.n : 0, aligned: aligned,
            fit: best ? best.fit : null, bbox: bbox,
            recommended: aligned ? { scale: best.fit.scale, offsetX: best.fit.offsetX, offsetY: best.fit.offsetY, method: 'points' }
                                 : { scale: bbox.scale, offsetX: bbox.offsetX, offsetY: bbox.offsetY, method: 'bbox' }
        };
    }


    /* ---------------------------------------------------------- */
    /*  Affichage                                                  */
    /* ---------------------------------------------------------- */

    function f(v, d) { return (typeof v === 'number' && isFinite(v)) ? v.toFixed(d === undefined ? 2 : d) : String(v); }

    function formatStats(s) {
        return 'n=' + s.n + ' | erreur max ' + f(s.maxAbs) + ' | moyenne ' + f(s.meanAbs) + ' | RMS ' + f(s.rms) +
               ' | dans la tolérance (' + s.tolerance + ') : ' + s.withinTol + '/' + s.n + ' (' + f(s.pctWithinTol, 1) + ' %)' +
               '\n   biais A ' + f(s.biasA) + ', B ' + f(s.biasB) + ' | rapport calculé/attendu A ' + f(s.scaleFitA, 4) +
               ', B ' + f(s.scaleFitB, 4);
    }

    function formatReport(res, opts) {
        var maxRows = (opts && opts.maxRows) || 15, out = [];
        if (res.type === 'placement') {
            var r = res.recommended;
            out.push('Placement estimé (SVG : ' + res.countSvg + ' points, référence : ' + res.countReference + ' déplacements)');
            if (res.aligned) {
                out.push('Appariement point à point OK (décalage de la référence : ' + res.shift + ', ' + res.n + ' points) — résidu RMS ' +
                         f(res.fit.rms) + ' mm, max ' + f(res.fit.max) + ' mm');
                out.push('Zoom par axe : X ' + f(res.fit.perAxis.sx, 4) + ', Y ' + f(res.fit.perAxis.sy, 4) +
                         (Math.abs(res.fit.perAxis.sx / res.fit.perAxis.sy - 1) > 0.005 ? '  ⚠ différents : déformation non uniforme' : ''));
            } else {
                out.push('⚠ Appariement point à point impossible (les deux tracés n\'ont pas la même suite de points) : ' +
                         'estimation par boîtes englobantes' + (res.fit ? ' (meilleur résidu point à point : max ' + f(res.fit.max) + ' mm)' : '') + '.');
                out.push('Zoom par boîte : X ' + f(res.bbox.scale, 4) + ', Y ' + f(res.bbox.scaleY, 4));
            }
            out.push('→ svg2gcode(svg, { scale: ' + f(r.scale, 4) + ', offsetX: ' + f(r.offsetX, 2) + ', offsetY: ' + f(r.offsetY, 2) + ' }, Parameters)');
            return out.join('\n');
        }
        if (res.type === 'diagnosis') {
            out.push('Diagnostic sur ' + res.n + ' points — meilleures hypothèses :');
            res.ranking.forEach(function (r, i) {
                out.push((i + 1) + '. ' + r.label + '\n   ' + formatStats(r.stats));
            });
            if (res.widthEstimate) {
                var w = res.widthEstimate;
                out.push('\nLargeur machine déduite de l\'échantillon (mm) : médiane ' + f(w.medianMM, 1) +
                         ' [' + f(w.minMM, 1) + ' ; ' + f(w.maxMM, 1) + '] — paramètre actuel : ' + f(w.declaredMM, 1));
            }
        } else {
            out.push(res.type === 'gcode'
                ? 'Déplacements : référence ' + res.countExpected + ', généré ' + res.countActual
                : 'Configuration : ' + describeConfig(res.config));
            out.push(formatStats(res.stats));
            if (res.firstMismatch) {
                var m = res.firstMismatch;
                out.push('Premier écart : déplacement #' + m.i + ' (A ' + f(m.expA) + ' → ' + f(m.calcA) + ', B ' +
                         f(m.expB) + ' → ' + f(m.calcB) + ')');
            }
            var bad = res.rows.filter(function (r) { return !r.ok; }).slice(0, maxRows);
            if (bad.length) {
                out.push('Premiers points hors tolérance :');
                bad.forEach(function (r) {
                    out.push('  ' + (r.i !== undefined ? '#' + r.i : '(' + r.x + ', ' + r.y + ')') +
                             '  A ' + f(r.expA) + ' / ' + f(r.calcA) + ' (Δ ' + f(r.dA) + ')' +
                             '  B ' + f(r.expB) + ' / ' + f(r.calcB) + ' (Δ ' + f(r.dB) + ')');
                });
            }
        }
        return out.join('\n');
    }


    var api = {
        parseSamplePoints: parseSamplePoints, parseGcodeMoves: parseGcodeMoves,
        compareSamplePoints: compareSamplePoints, diagnoseSample: diagnoseSample,
        estimateMachineWidth: estimateMachineWidth, compareGcode: compareGcode, fitPlacement: fitPlacement, formatReport: formatReport
    };
    root.CompareCoords = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : globalThis);