// AUTHOR: Dylan Lettinga
// EMAIL: msdostoevsky@protonmail.com

const fs = require("fs");
const Mustache = require("mustache");
const _ = require("lodash");
const yaml = require("js-yaml");

const BAD_YAML_MESSAGE =
	"[FATAL] Something about your yaml doesn't seem right. I can't process it.";

/**
 * Main generator function.
 * @param {string} inputFile - input swagger/openapi file for processing.
 * @param {string} outputDirectory - desired output directory for generated files.
 * @param {boolean} isApiMonolith - flag indicating whether to treat this api as monolithic.
 */
exports.generate = (inputFile, outputDirectory, isApiMonolith) => {
	let openApiFile = undefined;

	try {
		openApiFile = yaml.load(fs.readFileSync(inputFile, "utf8"));
	} catch (error) {
		return console.log(BAD_YAML_MESSAGE);
	}

	if (!openApiFile) {
		return console.log(BAD_YAML_MESSAGE);
	}

	if (!fs.existsSync(outputDirectory)) {
		fs.mkdirSync(outputDirectory);
	}

	const baseOutputDirectory = `${outputDirectory}/api/`;

	if (!fs.existsSync(baseOutputDirectory)) {
		fs.mkdirSync(baseOutputDirectory);
	}

	console.log("[INFO] Parsed API", openApiFile);

	// Generate microservice request functions (or multiple servlets).
	fs.readFile("templates/service.mustache", (error, data) => {
		const flatPathsGroupedByTag = _(openApiFile.paths)
			.flatMap((methods, path) => {
				return _.map(methods, (implementation, method) => {
					return {
						path: path,
						method: method,
						...implementation
					};
				});
			})
			.groupBy((flatPath) => _.head(flatPath.tags) || "default")
			.value();

		_.forEach(flatPathsGroupedByTag, (paths, tagName) => {
			const serviceDirectory = `${baseOutputDirectory}/${_.camelCase(tagName)}`;

			const mustacheContext = {
				BASE_PATH: openApiFile.basePath,
				FUNCTIONS: _.map(paths, (pathConfig) => {
					return {
						FUNCTION_SUMMARY: pathConfig.summary,
						FUNCTION_NAME:
							pathConfig.operationId ||
							generateOperationId(pathConfig.method, pathConfig.path),
						FUNCTION_PARAMS: _.map(pathConfig.parameters, (parameter) => {
							return {
								FUNCTION_PARAM: parameter.name,
								FUNCTION_PARAM_TYPE: translateType(parameter.schema),
								FUNCTION_PARAM_DESCRIPTION: parameter.description || "stub"
							};
						}),
						REQUEST_METHOD: pathConfig.method,
						REQUEST_PATH: () => _.replace(pathConfig.path, /{/g, "${")
					};
				})
			};

			if (!fs.existsSync(serviceDirectory)) {
				fs.mkdirSync(serviceDirectory);
			}

			const fileContent = Mustache.render(_.toString(data), mustacheContext);

			fs.writeFile(`${serviceDirectory}/index.ts`, fileContent, (error) => {
				if (error) {
					return console.log("[FATAL] Service file failed", tagName);
				}
				console.log("[SUCCESS] Service file created");
			});
		});
	});

	// Generate all types for models.
	fs.readFile("templates/apiModelTypes.mustache", (error, data) => {
		const mustacheContext = {
			MODELS: _.map(openApiFile.components.schemas, (schema, schemaName) => {
				return {
					MODEL_NAME: schemaName,
					MODEL_DESCRIPTION: schema.description,
					MODEL_PROPERTIES: _.map(schema.properties, (property, propertyName) => {
						return {
							PROPERTY_NAME: propertyName,
							MODEL_DESCRIPTION: property.description,
							PROPERTY_TYPE: translateType(property)
						};
					})
				};
			})
		};

		const fileContent = Mustache.render(_.toString(data), mustacheContext);

		fs.writeFile(`${baseOutputDirectory}/apiModelTypes.ts`, fileContent, (error) => {
			if (error) {
				return console.log("[FATAL] Api model types file failed");
			}
			console.log("[SUCCESS] Api model types file created");
		});
	});

	// Generate all runtime models from schema.
	fs.readFile("templates/apiModels.mustache", (error, data) => {
		const mustacheContext = {
			MODELS: _.map(openApiFile.components.schemas, (schema, schemaName) => {
				return {
					MODEL_NAME: schemaName,
					MODEL_DESCRIPTION: schema.description,
					MODEL_PROPERTIES: _.map(schema.properties, (property, propertyName) => {
						return {
							PROPERTY_NAME: propertyName,
							PROPERTY_DEFAULT: property.default || generateDefaultValue(property),
							PROPERTY_MINIMUM: property.minimum || property.minLength || "undefined",
							PROPERTY_MAXIMUM: property.maximum || property.maxLength || "undefined"
						};
					})
				};
			})
		};

		const fileContent = Mustache.render(_.toString(data), mustacheContext);

		fs.writeFile(`${baseOutputDirectory}/apiModels.ts`, fileContent, (error) => {
			if (error) {
				return console.log(error);
			}
			console.log("[SUCCESS] Api models file created");
		});
	});
};

/**
 * Extracts the name of the schema item from the open api $ref string.
 * @param {string} ref - the open api yaml $ref string.
 * @returns the name of the schema.
 */
function getSchema(ref) {
	return _(ref).split("/").last();
}

/**
 * In absence of a proper operation ID, cobble together one for user.
 * @param {string} method - the API request method.
 * @param {string} path - the API path.
 * @returns best guess at a good operation ID.
 */
function generateOperationId(method, path) {
	return _.camelCase(`${method}${path}`);
}

/**
 * Translates a data type from OpenAPI to a Typescript data type (if it is not common between them).
 * For more info on OpenAPI data types https://swagger.io/docs/specification/data-models/data-types/
 * @param {object} schema
 * @returns typescript data type.
 */
function translateType(schema) {
	let propertyType;

	if (!schema.type && schema.$ref) {
		propertyType = getSchema(schema.$ref);
	} else if (!schema.type && schema.enum) {
		// TODO: Handle enum types.
		propertyType = "any";
	} else if (schema.type === "integer") {
		propertyType = "number";
	} else if (schema.type === "array") {
		propertyType = `Array<${getSchema(schema.items.$ref) || schema.items.type}>`;
	} else {
		propertyType = schema.type;
	}

	return propertyType;
}

/**
 * Generates a reasonable default value when representing a schema as a runtime value.
 * For more info on OpenAPI data types https://swagger.io/docs/specification/data-models/data-types/
 * @param {object} schema - the open api schema object
 * @returns typescript data type.
 */
function generateDefaultValue(schema) {
	let defaultValue;

	if (schema.oneOf) {
		defaultValue = generateDefaultValue(_.head(schema.oneOf));
	} else if (schema.type === "integer" || schema.type === "number") {
		defaultValue = schema.minimum || 0;
	} else if (schema.type === "string") {
		defaultValue = "''";
	} else if (schema.type === "array") {
		defaultValue = "[]";
	} else {
		defaultValue = "undefined";
	}

	return defaultValue;
}
