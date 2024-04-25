#!/usr/bin/env node

const yargs = require("yargs")
	.usage(`Usage: npx taggem [-m] [-s] [-n] [-v] path/to/input-file.y(a)ml /path/to/output/directory/`)
	.describe({
		m: "Treat as a monolithic API and split directories by open api tag.",
		s: "Treat as a microservice API, assume there are other files to process, and make a single directory to store api functions ignoring tags.",
		n: "The desired name of this api service.",
		v: "The major Axios version to support - defaults to 0. See header type changes in 1.0 release https://github.com/axios/axios/blob/v1.x/CHANGELOG.md#100---2022-10-04"
	})
	.string(["n"])
	.boolean(["m", "s"])
	.number("v")
	.help()
	.alias("m", "monolith")
	.alias("s", "service")
	.alias("n", "name")

const argv = yargs.argv;

if (argv._.length < 2) {
	yargs.showHelp();
} else {
	const inputFile = argv._[0];
	const userOutputDirectory = argv._[1];
	const isApiMonolith = argv.m || !argv.s;
	const serviceName = argv.n;
	const axiosVersion = argv.v;

	require("./index").generate(inputFile, userOutputDirectory, isApiMonolith, serviceName, axiosVersion);
}
