const packageInfo = require("./package.json");

console.log(
    `
* Project:      ${packageInfo.name}
* Description:  ${packageInfo.description}
* Version:      ${packageInfo.version}
`.trim()
);

const entries = "./modules/webtrack.js";
const myScripts = ["*.js", "modules/*.js", "test/*.js"];

var browserify = require("browserify"),
    gulp = require("gulp"),
    source = require("vinyl-source-stream"),
    buffer = require("vinyl-buffer"),
    sourcemaps = require("gulp-sourcemaps"),
    uglify = require("gulp-uglify"),
    babelify = require("babelify"),
    babel = require("gulp-babel"),
    notify = require("gulp-notify"),
    log = require("gulplog"),
    prettier = require("gulp-prettier");

gulp.task("default", () => {
    var b = browserify({
        entries: entries,
        debug: true,
        standalone: "WebTrack",
    }).transform(babelify.configure(packageInfo.babel));

    return b
        .bundle()
        .pipe(source("webtrack.min.js"))
        .pipe(buffer())
        .pipe(sourcemaps.init({ loadMaps: true }))
        .pipe(babel(packageInfo.babel))
        .pipe(uglify())
        .on("error", log.error)
        .pipe(sourcemaps.write("./"))
        .pipe(gulp.dest("./dist/"))
        .pipe(
            notify({
                onLast: true,
                title: "Updated <%= file.relative %>",
                message: "JS file generated",
            })
        );
});

gulp.task("prettier-validation", () => {
    return gulp.src(myScripts).pipe(prettier.check({ tabWidth: 4 }));
});

gulp.watch(entries, gulp.series("default"));
