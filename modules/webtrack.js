// @flow

/*!
 * MIT License
 *
 * Copyright (c) 2020 Clement
 * Copyright (c) 2018 Lucas Trebouet Voisin
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

type XMLDocument = any;
type Point = Array<any>;
type WayPoint = {
    lat: number,
    lon: number,
    ele?: ?number,
    sym?: string,
    name?: string,
    cumulDist?: number,
};
type Segment = {
    withEle: boolean,
    points: Array<Point>,
};

/** Interface with the WebTrack file format. */
class WebTrack {
    /** The WebTrack format name, constant. */
    #formatName: string = "webtrack-bin";

    /** The WebTrack format version, constant. */
    #formatVersion: string = "0.1.0";

    /** A list of segments in the WebTrack format. */
    #reformatedTracks: Array<Segment> = [];

    /** A list of waypoints in the WebTrack format. */
    #waypoints: Array<WayPoint> = [];

    /** Information about whole track (elevation statistics, etc.) */
    #trackInfo: {
        length: number,
        min?: number,
        max?: number,
        gain?: number,
        loss?: number,
        trackPoints?: {
            withEle: number,
            withoutEle: number,
        },
    } = {};

    /** Buffer used when loading a GPX string or a WebTrack buffer. */
    #buffer: ?ArrayBuffer = null;

    /** The size in bytes of the buffer. */
    #bufferSize: number = 0;

    /** The total amount of points containing elevation data. */
    #pointsWithEle: number = 0;

    /** The total amount of points not containing elevation data. */
    #pointsWithoutEle: number = 0;

    /** The current position in the buffer. */
    #currentPos: number = 0;

    /** The total amount of waypoints. */
    #totalWaypoints: number = 0;

    /** The DataView of the buffer. */
    #view: DataView;

    /**
     * Load a GPX string and create a WebTrack buffer.
     * @param gpxString The GPX string.
     * @return this
     */
    loadGPX(gpxString: string): WebTrack {
        this.#reformatedTracks = [];
        this.#waypoints = [];
        this.#pointsWithEle = 0;
        this.#pointsWithoutEle = 0;
        let domParser = new window.DOMParser();
        let xmlSource: XMLDocument = domParser.parseFromString(
            gpxString.trim(),
            "text/xml"
        );

        let trks = [].slice.call(xmlSource.querySelectorAll("trk"));
        let prevPt = {};
        let min = Number.POSITIVE_INFINITY,
            max = Number.NEGATIVE_INFINITY,
            gain = 0,
            loss = 0;

        trks.forEach((trk) => {
            // loop over <trk/>
            let trackpoints = [];
            let trkpts = [].slice.call(trk.querySelectorAll("trkpt"));

            let segment: Segment = {};
            let isFirst = true;
            let prevEle = null;

            trkpts.forEach((trkpt) => {
                // loop over <trkpt/>
                let pt: WayPoint = {};
                pt.lat = parseFloat(trkpt.getAttribute("lat"));
                pt.lon = parseFloat(trkpt.getAttribute("lon"));
                pt.ele =
                    parseFloat(this._getElementValue(trkpt, "ele")) || null;
                if (
                    Object.keys(prevPt).length === 0 &&
                    prevPt.constructor === Object
                ) {
                    pt.cumulDist = 0.0;
                } else {
                    pt.cumulDist =
                        //$FlowIgnore[unsafe-addition] operation with satisfying conditions
                        prevPt.cumulDist + this.distanceBetween(prevPt, pt);
                }
                prevPt = { ...pt };
                trackpoints.push(pt);
                let webPt = this.gpsToWeb(pt.lon, pt.lat);

                if (isFirst) {
                    if (pt.ele === null) {
                        segment.withEle = false;
                        segment.points = [[...webPt, pt.cumulDist]];
                    } else {
                        segment.withEle = true;
                        segment.points = [[...webPt, pt.cumulDist, pt.ele]];
                    }
                    isFirst = false;
                } else {
                    if (pt.ele === null) {
                        if (segment.withEle) {
                            // split
                            this.#pointsWithEle += segment.points.length;
                            this.#reformatedTracks.push(segment);
                            segment = {}; // fresh segment
                            segment.withEle = false;
                            segment.points = [[...webPt, pt.cumulDist]];
                        } else {
                            segment.points.push([...webPt, pt.cumulDist]);
                        }
                    } else {
                        if (!segment.withEle) {
                            this.#pointsWithoutEle += segment.points.length;
                            this.#reformatedTracks.push(segment);
                            segment = {};
                            segment.withEle = true;
                            segment.points = [[...webPt, pt.cumulDist, pt.ele]];
                        } else {
                            segment.points.push([
                                ...webPt,
                                pt.cumulDist,
                                pt.ele,
                            ]);
                        }
                    }
                }

                if (pt.ele !== null) {
                    if (prevEle !== null) {
                        //$FlowIgnore[unsafe-addition]
                        var diff = pt.ele - prevEle;
                        if (diff < 0) {
                            loss -= diff;
                        } else if (diff > 0) {
                            gain += diff;
                        }
                    }
                    //$FlowIgnore[invalid-compare]
                    if (min > pt.ele) {
                        min = pt.ele;
                    }
                    //$FlowIgnore[invalid-compare]
                    if (max < pt.ele) {
                        max = pt.ele;
                    }
                    prevEle = pt.ele;
                }
            });

            if (segment) {
                if (segment.withEle) {
                    this.#pointsWithEle += segment.points.length;
                } else {
                    this.#pointsWithoutEle += segment.points.length;
                }
                this.#reformatedTracks.push(segment);
            }

            if (this.#reformatedTracks.length > 255) {
                throw "Failed to load the GPX string: exceeding 255 segments";
            }
        });

        this.#trackInfo = {
            length: this.getTrackLength(),
            min: min,
            max: max,
            gain: gain,
            loss: loss,
        };

        var wpts = [].slice.call(xmlSource.querySelectorAll("wpt"));

        wpts.forEach((wpt) => {
            // loop over <wpt/>
            let time = this._getElementValue(wpt, "time");
            let coords = this.gpsToWeb(
                parseFloat(wpt.getAttribute("lon")),
                parseFloat(wpt.getAttribute("lat"))
            );

            this.#waypoints.push({
                name: this._getElementValue(wpt, "name") || null,
                sym: this._getElementValue(wpt, "sym") || null,
                lon: coords[0],
                lat: coords[1],
                ele: parseFloat(this._getElementValue(wpt, "ele")) || null,
                time: time == null ? null : new Date(time),
            });
        });

        this.#totalWaypoints = this.#waypoints.length;

        this.#bufferSize =
            this._fmtArraySize() +
            this._trksArraySize() +
            this._wptsArraySize();

        this.createBuffer();
        return this;
    }

    /**
     * Get value from a XML DOM element
     *
     * @param  {Element} parent - Parent DOM Element
     * @param  {string} needle - Name of the searched element
     *
     * @return The element value
     */
    _getElementValue(parent: Element, needle: string): any {
        let elem = parent.querySelector(needle);
        if (elem != null) {
            return elem.innerHTML != undefined
                ? elem.innerHTML
                : //$FlowIgnore[prop-missing]
                  elem.childNodes[0].data;
        }
        return elem;
    }

    /**
     * Compute the dstance between two points.
     *
     * @param  {WayPoint} wpt1 - A geographic point with lat and lon properties
     * @param  {WayPoint} wpt2 - A geographic point with lat and lon properties
     *
     * @returns {float} The distance between the two points
     */
    distanceBetween(wpt1: WayPoint, wpt2: WayPoint): number {
        let latlng1 = {};
        latlng1.lat = wpt1.lat;
        latlng1.lon = wpt1.lon;
        let latlng2 = {};
        latlng2.lat = wpt2.lat;
        latlng2.lon = wpt2.lon;
        var rad = Math.PI / 180,
            lat1 = latlng1.lat * rad,
            lat2 = latlng2.lat * rad,
            sinDLat = Math.sin(((latlng2.lat - latlng1.lat) * rad) / 2),
            sinDLon = Math.sin(((latlng2.lon - latlng1.lon) * rad) / 2),
            a =
                sinDLat * sinDLat +
                Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon,
            c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return 6371008 * c;
    }

    /**
     * Returns the first characters that should be in the WebTrack file.
     * Example: 'webtrack-bin:0.1.2:'
     * @return ASCII characters.
     */
    _fmtText(): string {
        return `${this.#formatName}:${this.#formatVersion}:`;
    }

    /**
     * Returns the length in bytes of the "Format Information" section.
     * @return Number of bytes.
     */
    _fmtArraySize(): number {
        return this._fmtText().length + 3;
    }

    /**
     * Returns the length in bytes of the "Segment Headers",
     * plus the "Track Information", plus the "Segment" sections.
     * @return Number of bytes.
     */
    _trksArraySize(): number {
        const totalSegments = this.#reformatedTracks.length;
        let trksArraySize = 0;

        if (totalSegments > 0) {
            // segment headers:
            trksArraySize += totalSegments * 5;
            // tracks info (length):
            trksArraySize += 4;
            if (this.#pointsWithEle > 0) {
                // tracks info (ele min/max/gain/loss):
                trksArraySize += 12;
            }

            trksArraySize +=
                totalSegments * 4 +
                this.#pointsWithoutEle * 6 +
                this.#pointsWithEle * 8;
        }

        return trksArraySize;
    }

    /**
     * Returns the length in bytes of the "Waypoints" section.
     * @return Number of bytes.
     */
    _wptsArraySize(): number {
        let wptsArraySize = 0;

        this.#waypoints.forEach((waypoint) => {
            wptsArraySize +=
                11 +
                (waypoint.ele ? 2 : 0) +
                (waypoint.sym ? waypoint.sym.length : 0) +
                (waypoint.name ? waypoint.name.length : 0);
        });

        return wptsArraySize;
    }

    /**
     * Returns true if there is at least one point with elevation data.
     * @return False if there isn't a single point with elevation, true otherwise.
     */
    someTracksWithEle(): boolean {
        return this.#pointsWithEle > 0;
    }

    /**
     * Returns the size of the buffer.
     * @return Number of bytes.
     */
    getBufferSize(): number {
        return this.#bufferSize;
    }

    /**
     * Append a uint8 element to the buffer and increment the current position.
     * @param data The element to add into the buffer.
     */
    _wUint8(data: number) {
        this.#view.setUint8(this.#currentPos++, data);
    }

    /**
     * Read a uint8 element from the buffer at the current position and
     * increment the cursor.
     * @return The byte from the buffer.
     */
    _rUint8(): number {
        return this.#view.getUint8(this.#currentPos++);
    }

    /**
     * Append a uint16 element to the buffer and increment the current position.
     * @param data The element to add into the buffer.
     */
    _wUint16(data: number) {
        this.#view.setUint16(this.#currentPos, data, false);
        this.#currentPos += 2;
    }

    /**
     * Read a uint16 element from the buffer at the current position and
     * increment the cursor.
     * @return The bytes from the buffer.
     */
    _rUint16(): number {
        let pos = this.#currentPos;
        this.#currentPos += 2;
        return this.#view.getUint16(pos, false);
    }

    /**
     * Append a int16 element to the buffer and increment the current position.
     * @param data The element to add into the buffer.
     */
    _wInt16(data: number) {
        this.#view.setInt16(this.#currentPos, data, false);
        this.#currentPos += 2;
    }

    /**
     * Read a int16 element from the buffer at the current position and
     * increment the cursor.
     * @return The bytes from the buffer.
     */
    _rInt16(): number {
        let pos = this.#currentPos;
        this.#currentPos += 2;
        return this.#view.getInt16(pos, false);
    }

    /**
     * Append a uint32 element to the buffer and increment the current position.
     * @param data The element to add into the buffer.
     */
    _wUint32(data: number) {
        this.#view.setUint32(this.#currentPos, data, false);
        this.#currentPos += 4;
    }

    /**
     * Read a uint32 element from the buffer at the current position and
     * increment the cursor.
     * @return The bytes from the buffer.
     */
    _rUint32(): number {
        let pos = this.#currentPos;
        this.#currentPos += 4;
        return this.#view.getUint32(pos, false);
    }

    /**
     * Append a int32 element to the buffer and increment the current position.
     * @param data The element to add into the buffer.
     */
    _wInt32(data: number) {
        this.#view.setInt32(this.#currentPos, data, false);
        this.#currentPos += 4;
    }

    /**
     * Read a int32 element from the buffer at the current position and
     * increment the cursor.
     * @return The bytes from the buffer.
     */
    _rInt32(): number {
        let pos = this.#currentPos;
        this.#currentPos += 4;
        return this.#view.getInt32(pos, false);
    }

    /**
     * Projection of a GPS point (EPSG:4326) into the Web Mercator (EPSG:3857).
     * Formula based on:
     * Title: Implementation Practice Web Mercator Map Projection
     * Reference: NGA.SIG.0011_1.0.0_WEBMERC, 2014-02-18
     * Author: National Geospatial Intelligence Agency (NGA)
     * @param lon GPS longitude
     * @param lat GPS latitude
     * @return Web Mercator coordinates [easting, northing]
     */
    gpsToWeb(lon: number, lat: number): Point {
        const rad = Math.PI / 180;
        // ellipsoid semi-major axis [WSG 84 = 6378137m]:
        const a = 6378137;
        // no parseInt to reduce drift when substracting coordinates:
        return [
            // easting coordinate in the Web Mercator:
            lon * a * rad,
            // northing coordinate in the Web Mercator:
            a * Math.atanh(Math.sin(lat * rad)),
        ];
    }

    /**
     * Returns essential information about the track.
     */
    getTrackInfo(): {} {
        return {
            ...this.#trackInfo,
            trackPoints: {
                withEle: this.#pointsWithEle,
                withoutEle: this.#pointsWithoutEle,
            },
        };
    }

    /**
     * Returns an array of segments in the WebTrack format.
     */
    getTrack(): Array<Segment> {
        return this.#reformatedTracks;
    }

    /**
     * Returns an array of waypoints in the WebTrack format.
     */
    getWaypoints(): Array<WayPoint> {
        return this.#waypoints;
    }

    /**
     * Returns the length of the whole track.
     */
    getTrackLength(): number {
        const lastSegment = this.#reformatedTracks[
            this.#reformatedTracks.length - 1
        ].points;
        return lastSegment[lastSegment.length - 1][2];
    }

    /**
     * Create a WebTrack buffer with the data fetched from the GPX string.
     * @return A WebTrack buffer ready to be stored.
     */
    createBuffer(): WebTrack {
        if (this.#bufferSize == 0) {
            throw "Failed to create the WebTrack buffer: empty buffer";
        }
        this.#buffer = new ArrayBuffer(this.#bufferSize);
        this.#view = new DataView(this.#buffer);
        const enc = new TextEncoder();
        const encoded = {
            withEle: enc.encode("E")[0],
            withoutEle: enc.encode("F")[0],
            separator: enc.encode("\n")[0],
        };

        // Format Information:

        const fmtText = enc.encode(this._fmtText());
        this.#currentPos = 0;

        fmtText.forEach((c) => {
            this._wUint8(c);
        });
        const totalSegments = this.#reformatedTracks.length;
        if (totalSegments > 255) {
            throw "Failed to create the WebTrack buffer: too many segments";
        }
        this._wUint8(totalSegments);
        if (this.#totalWaypoints > 65535) {
            throw "Failed to create the WebTrack buffer: too many waypoints";
        }
        this._wUint16(this.#totalWaypoints);

        // Segment Headers:

        this.#reformatedTracks.forEach((segment) => {
            let c = segment.withEle ? encoded.withEle : encoded.withoutEle;
            this._wUint8(c);
            // Number of points written in big-endian:
            this._wUint32(segment.points.length);
        });

        // Track Information:

        this._wUint32(Math.round(this.#trackInfo.length));
        if (this.someTracksWithEle()) {
            //$FlowIgnore[incompatible-call] condition satisfied
            this._wInt16(Math.round(this.#trackInfo.min));
            //$FlowIgnore[incompatible-call] condition satisfied
            this._wInt16(Math.round(this.#trackInfo.max));
            //$FlowIgnore[incompatible-call] condition satisfied
            this._wUint32(Math.round(this.#trackInfo.gain));
            //$FlowIgnore[incompatible-call] condition satisfied
            this._wUint32(Math.round(this.#trackInfo.loss));
        }

        // Points from segments:

        this.#reformatedTracks.forEach((segment) => {
            let prevPoint = null;
            segment.points.forEach((point) => {
                if (prevPoint === null) {
                    this._wInt32(Math.round(point[0]));
                    this._wInt32(Math.round(point[1]));

                    // cumulated distance:
                    this._wUint16(Math.round(point[2] / 10));
                } else {
                    // rounding positions before diff to avoid drift
                    const deltaX =
                            Math.round(point[0]) - Math.round(prevPoint[0]),
                        deltaY =
                            Math.round(point[1]) - Math.round(prevPoint[1]);

                    const minDelta = -32768,
                        maxDelta = 32767;
                    if (
                        deltaX > maxDelta ||
                        deltaX < minDelta ||
                        deltaY > maxDelta ||
                        deltaY < minDelta
                    ) {
                        throw "Failed to create the WebTrack buffer: offset out or range";
                    }
                    this._wInt16(Math.round(deltaX));
                    this._wInt16(Math.round(deltaY));
                    this._wUint16(Math.round(point[2] / 10));
                }
                prevPoint = point;

                if (segment.withEle) {
                    this._wInt16(Math.round(point[3]));
                }
            });
        });

        // Points from waypoints:

        this.#waypoints.forEach((waypoint) => {
            this._wInt32(Math.round(waypoint.lon));
            this._wInt32(Math.round(waypoint.lat));
            this._wUint8(waypoint.ele ? encoded.withEle : encoded.withoutEle);
            if (waypoint.ele) {
                this._wInt16(Math.round(waypoint.ele));
            }
            if (waypoint.sym) {
                const symText = enc.encode(waypoint.sym);
                symText.forEach((c) => {
                    this._wUint8(c);
                });
            }
            this._wUint8(encoded.separator);
            if (waypoint.name) {
                const nameText = enc.encode(waypoint.name);
                nameText.forEach((c) => {
                    this._wUint8(c);
                });
            }
            this._wUint8(encoded.separator);
        });

        if (this.#currentPos != this.#bufferSize) {
            throw "Failed to create the WebTrack buffer: final position and buffer size mismatch";
        }

        return this;
    }

    /**
     * Returns the output buffer if not null, otherwise the input buffer.
     * @return Buffer or null/undefined if both the input and the output buffer are null/undefined.
     */
    getBuffer(): ?ArrayBuffer {
        return this.#buffer;
    }

    /**
     * Check if the first bytes of the input buffer match the file format.
     * Returns false if the input buffer is null or undefined.
     * @see loadWebTrack()
     * @return True if match, false otherwise
     */
    _formatInfoPass(): boolean {
        if (!this.#buffer) {
            return false;
        }
        const dec = new TextDecoder();
        const fmtInput = new Uint8Array(
            this.#buffer,
            0,
            this._fmtText().length
        );
        return this._fmtText() == dec.decode(fmtInput);
    }

    /**
     * Load a buffer containing the WebTrack.
     * The file format and version must be as defined by this class.
     * @param webtrackBytes The WebTrack buffer
     * @return this
     */
    loadWebTrack(webtrackBytes: ArrayBuffer): WebTrack {
        if (!webtrackBytes) {
            throw "Failed to load WebTrack: bad input buffer";
        }
        this.#buffer = webtrackBytes;
        let typedBuffer = new Uint8Array(webtrackBytes);
        this.#bufferSize = typedBuffer.length;

        // Format Information:

        if (!this._formatInfoPass()) {
            throw "Failed to load WebTrack: bad file format";
        }

        const enc = new TextEncoder();
        const encoded = {
            withEle: enc.encode("E")[0],
            withoutEle: enc.encode("F")[0],
            separator: enc.encode("\n")[0],
        };
        //$FlowIgnore[incompatible-call] error thrown earlier if the buffer is null
        this.#view = new DataView(this.#buffer);
        this.#currentPos = this._fmtText().length;
        const totalSegments = this._rUint8();
        this.#totalWaypoints = this._rUint16();
        this.#reformatedTracks = new Array(totalSegments);
        this.#pointsWithEle = 0;
        this.#pointsWithoutEle = 0;

        // Segment Headers:

        for (let i = 0; i < totalSegments; i++) {
            let currSegType = this._rUint8(),
                points = this._rUint32(),
                withEle;
            switch (currSegType) {
                case encoded.withEle:
                    withEle = true;
                    this.#pointsWithEle += points;
                    break;
                case encoded.withoutEle:
                    withEle = false;
                    this.#pointsWithoutEle += points;
                    break;
                default:
                    throw "Failed to load WebTrack: bad segment type";
            }
            this.#reformatedTracks[i] = {
                withEle: withEle,
                points: new Array(points),
            };
        }

        // Track Information:

        if (totalSegments) {
            let length = this._rUint32();
            if (this.someTracksWithEle()) {
                this.#trackInfo = {
                    length: length,
                    min: this._rInt16(),
                    max: this._rInt16(),
                    gain: this._rUint32(),
                    loss: this._rUint32(),
                };
            } else {
                this.#trackInfo = {
                    length: length,
                };
            }
        } else {
            this.#trackInfo = {};
        }

        // Points from segments:

        for (let i = 0; i < totalSegments; i++) {
            const totalPointsInSegment = this.#reformatedTracks[i].points
                .length;
            const segWithEle = this.#reformatedTracks[i].withEle;
            let prevPoint = null;

            for (let p = 0; p < totalPointsInSegment; p++) {
                if (prevPoint === null) {
                    prevPoint = [
                        this._rInt32(),
                        this._rInt32(),
                        this._rUint16() * 10,
                    ];
                } else {
                    prevPoint = [
                        this._rInt16() + prevPoint[0],
                        this._rInt16() + prevPoint[1],
                        this._rUint16() * 10,
                    ];
                }
                if (segWithEle) {
                    prevPoint = [...prevPoint, this._rInt16()];
                }
                this.#reformatedTracks[i].points[p] = prevPoint;
            }
        }

        // Points from waypoints:

        const dec = new TextDecoder();
        this.#waypoints = new Array(this.#totalWaypoints);
        for (let i = 0; i < this.#totalWaypoints; i++) {
            let wpt = {
                lon: this._rInt32(),
                lat: this._rInt32(),
            };

            switch (this._rUint8()) {
                case encoded.withEle:
                    wpt = { ...wpt, ele: this._rInt16() };
                    break;
                case encoded.withoutEle:
                    break;
                default:
                    throw "Failed to load WebTrack: bad waypoint type";
            }

            let arr = [];
            for (
                let c = this._rUint8();
                c != encoded.separator;
                c = this._rUint8()
            ) {
                arr.push(c);
            }
            let bytes = new Uint8Array(arr);
            let sym = dec.decode(bytes);

            arr = [];
            for (
                let c = this._rUint8();
                c != encoded.separator;
                c = this._rUint8()
            ) {
                arr.push(c);
            }
            bytes = new Uint8Array(arr);
            let name = dec.decode(bytes);

            this.#waypoints[i] = { ...wpt, sym: sym, name: name };
        }

        return this;
    }
}

//$FlowIgnore[invalid-export]
if (typeof module === "object" && module.exports) {
    //$FlowIgnore[invalid-export]
    module.exports = WebTrack;
}
