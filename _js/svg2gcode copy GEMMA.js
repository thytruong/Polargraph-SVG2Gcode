/**
 * Replicates the logic from Machine.pde: asNativeCoords
 * Converts Cartesian (X, Y) to Motor (Native) Coordinates
 */
function calculateNativeCoords(cartX, cartY, machineWidth, machineHeight) {
    const x = parseFloat(cartX);
    const y = parseFloat(cartY);
    const W = parseFloat(machineWidth);
    const H = parseFloat(machineHeight); // Machine height is usually not used in standard 2-pivot IK but included for completeness
    
    // distA = sqrt( x^2 + y^2 )
    const distA = Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2));
    
    // distB = sqrt( (x - W)^2 + y^2 )
    const distB = Math.sqrt(Math.pow(x - W, 2) + Math.pow(y, 2));
    
    return {
        x: distA,
        y: distB
    };
}

function svg2gcode(svg, settings, parameters) {
    svg = svg.replace(/^[\n\r \t]/gm, '');
    settings = settings || {};
    parameters = parameters || {};
    settings.scale = settings.scale || 1;

    var parsed = SVGReader.parse(svg, {});
    var paths = parsed.allcolors || [];
    var gcode = [];

    // The "Native" coordinate system is defined by the PX values in the JSON
    const machineWidthPX = parseFloat(parameters.widthPX); 
    const machineHeightPX = parseFloat(parameters.heightPX);

    // The "Motor" coordinate system (for home/start position) is defined by Motor values
    const startXMotor = parseFloat(parameters.xPosition) || 0;
    const startYMotor = parseFloat(parameters.yPosition) || 0;

    // START OF GCODE
    // 1. Move to home/start position (Pen UP)
    gcode.push('C09,' + startXMotor + ',' + startYMotor + ',END');
    
    // 2. Ensure Pen is UP before starting
    gcode.push('C14,END');

    // 3. Start Drawing (Continuous line: Pen Down at start)
    gcode.push('C13,END');

    if (paths.length > 0) {
        for (var pathIdx = 0, pathLength = paths.length; pathIdx < pathLength; pathIdx++) {
            var path = paths[pathIdx];
            if (!path || path.length === 0) continue;

            for (var segmentIdx = 0, segmentLength = path.length; segmentIdx < segmentLength; segmentIdx++) {
                var segment = path[segmentIdx];
                
                // Apply user scale
                var cartX = segment.x * settings.scale;
                var cartY = segment.y * settings.scale;
                
                // Calculate motor steps using PX-based width for IK
                var native = calculateNativeCoords(cartX, cartY, machineWidthPX, machineHeightPX);
                
                // Output as integer (Motor Steps)
                // We use 2 as the 4th parameter for "Pen Down" in C17
                gcode.push(['C17', Math.round(native.x), Math.round(native.y), '2', 'END'].join(','));
            }
        }
        
        // 4. Pen UP at the very end of the drawing
        gcode.push('C14,END');
    }

    // 5. Return to Home (Pen UP)
    gcode.push(['C17', Math.round(startXMotor), Math.round(startYMotor), '1', 'END'].join(','));
    
    return gcode.join('\n');
}