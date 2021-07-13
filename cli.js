#!/usr/bin/env node
const yargs = require("yargs")
	.usage(`Usage: npx taggem [-m] [-s] [-n] path/to/input-file.y(a)ml /path/to/output/directory/`)
	.describe({
		m: "Treat as a monolithic API and split directories by open api tag.",
		s: "Treat as a microservice API, assume there are other files to process, and make a single directory to store api functions ignoring tags.",
		n: "The desired name of this api service."
	})
	.string(["n"])
	.boolean(["m", "s"])
	.help()
	.alias("m", "monolith")
	.alias("s", "service")
	.alias("n", "name");

const argv = yargs.argv;

if (argv._.length < 2) {
	yargs.showHelp();
} else {
	const inputFile = argv._[0];
	const userOutputDirectory = argv._[1];
	const isApiMonolith = argv.m || !argv.s;
	const serviceName = argv.n;

	require("./index").generate(inputFile, userOutputDirectory, isApiMonolith, serviceName);
}
