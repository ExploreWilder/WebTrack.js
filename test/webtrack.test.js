import {
    gpxString,
    webTrackWaypoints,
    roundedStats,
} from "./Gillespie_Circuit.gpx.js";
import WebTrack from "../modules/webtrack.js";
const proj4 = require("proj4");
require("jsdom-global")();
let myWebTrack = new WebTrack();

const assert = require("assert");

describe("WebTrack Parser", () => {
    it("should project GPS points into the Web Marcator", () => {
        const points = [
            [-44.264449439899998, 169.20350999569999],
            [-44.261094667000002, 169.1968584526],
            [44.3403714616, 6.8494503759],
            [44.2399341334, 7.0426671579],
        ];
        points.forEach((point) => {
            const [lat, lon] = point;
            const extLibCoords = proj4("EPSG:4326", "EPSG:3857", [lon, lat]);
            const intLibCoords = myWebTrack.gpsToWeb(lon, lat);
            assert.equal(
                Math.fround(extLibCoords[0]),
                Math.fround(intLibCoords[0])
            );
            assert.equal(
                Math.fround(extLibCoords[1]),
                Math.fround(intLibCoords[1])
            );
        });
    });

    it("should load the GPX string", () => {
        myWebTrack.loadGPX(gpxString);
        assert.notEqual(myWebTrack.getBufferSize(), 0);
    });

    it("should have tracks with elevation data", () => {
        assert.equal(myWebTrack.someTracksWithEle(), true);
    });

    it("should have statistics", check_stats);

    it("should have the expected waypoints", () => {
        const gpxWaypoints = myWebTrack.getWaypoints();
        assert.notEqual(gpxWaypoints, []);
        assert.equal(gpxWaypoints.length, webTrackWaypoints.length);
        for (let i = 0; i < webTrackWaypoints.length; i++) {
            let data = gpxWaypoints[i];
            let origin = webTrackWaypoints[i];
            if (origin.ele) {
                assert.equal(Math.round(data.ele), Math.round(origin.ele));
            }
            assert.equal(Math.round(data.lon), Math.round(origin.lon));
            assert.equal(Math.round(data.lat), Math.round(origin.lat));
            assert.equal(data.name, origin.name);
            assert.equal(data.sym, origin.sym);
            assert.deepEqual(data.time, origin.time);
        }
    });

    it("should have the expected segments", () => {
        const gpxTrack = myWebTrack.getTrack();
        assert.equal(gpxTrack.length, 4);
        assert.equal(gpxTrack[0].withEle, true);
        assert.equal(gpxTrack[1].withEle, false);
        assert.equal(gpxTrack[2].withEle, true);
        assert.equal(gpxTrack[2].points.length, 1); // singleton splitting the track
        let ptFromWebTrack = gpxTrack[2].points[0];
        let ptFromGPX = myWebTrack.gpsToWeb(
            169.15112972259521,
            -44.258416956926759
        );
        assert.equal(Math.round(ptFromWebTrack[0]), Math.round(ptFromGPX[0]));
        assert.equal(Math.round(ptFromWebTrack[1]), Math.round(ptFromGPX[1]));
        assert.equal(gpxTrack[3].withEle, false);
    });

    function check_stats() {
        let gpxStats = myWebTrack.getTrackInfo();
        assert.equal(Math.round(gpxStats.length), roundedStats.length);
        assert.equal(Math.round(gpxStats.gain), roundedStats.gain);
        assert.equal(Math.round(gpxStats.loss), roundedStats.loss);
        assert.equal(Math.round(gpxStats.min), roundedStats.min);
        assert.equal(Math.round(gpxStats.max), roundedStats.max);
    }

    it("should load the generated WebTrack", () => {
        myWebTrack.loadWebTrack(myWebTrack.getBuffer());
    });

    it("should have statistics", check_stats);

    it("should not drift along a WebTrack segment", () => {
        const trk = myWebTrack.getTrack();
        let ptFromWebTrack = trk[0].points[0];
        let ptFromGPX = myWebTrack.gpsToWeb(
            169.20353891330001,
            -44.264620430800001
        );
        assert.equal(Math.round(ptFromWebTrack[0]), Math.round(ptFromGPX[0]));
        assert.equal(Math.round(ptFromWebTrack[1]), Math.round(ptFromGPX[1]));
        ptFromWebTrack = trk[0].points[trk[0].points.length - 1];
        ptFromGPX = myWebTrack.gpsToWeb(
            169.17430249969999,
            -44.263434140000001
        );
        assert.equal(Math.abs(ptFromWebTrack[0] - ptFromGPX[0]) < 1, true);
        assert.equal(Math.abs(ptFromWebTrack[1] - ptFromGPX[1]) < 1, true);
    });

    it("GPX and WebTrack buffers should have the same size", () => {
        const webTrackBufferSize = myWebTrack.getBufferSize();
        assert.notEqual(webTrackBufferSize, 0);
        myWebTrack.loadGPX(gpxString);
        const gpxBufferSize = myWebTrack.getBufferSize();
        assert.equal(gpxBufferSize, webTrackBufferSize);
    });
});
