// AUTHOR: Dylan Lettinga
// EMAIL: msdostoevsky@protonmail.com

const fs = require("fs");
const Mustache = require("mustache");
const _ = require("lodash");
const yaml = require("js-yaml");
const Download = require("./download");

const BAD_YAML_MESSAGE =
	"[FATAL] Something about your yaml doesn't seem right. I can't process it.";

/**
 * Main generator function.
 * @param {string} inputFile - input swagger/openapi file for processing.
 * @param {string} outputDirectory - desired output directory for generated files.
 * @param {boolean} isApiMonolith - flag indicating whether to treat this api as monolithic.
 */
exports.generate = async (inputFile, outputDirectory, isApiMonolith) => {
	let openApiFile = undefined;
	try {
		if (_.startsWith(inputFile, "https://")) {
			openApiFile = yaml.load(await Download.download(inputFile));
		} else {
			openApiFile = yaml.load(fs.readFileSync(inputFile, "utf8"));
		}
	} catch (error) {
		console.log(error);
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
	fs.readFile("./templates/service.mustache", (error, data) => {
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
				BASE_PATH: "`${process.env.REACT_APP_API_URL}`",
				FUNCTIONS: _.map(paths, (pathConfig) => {
					const queryParams = _.filter(pathConfig.parameters, (parameter) => {
						return parameter.in === "query";
					});

					const headQueryName = !_.isEmpty(queryParams) && _.head(queryParams).name;

					return {
						FUNCTION_SUMMARY: pathConfig.summary,
						FUNCTION_NAME:
							pathConfig.operationId ||
							generateOperationId(pathConfig.method, pathConfig.path),
						FUNCTION_PARAMS: pathConfig.parameters && {
							FUNCTION_PARAM_CONFIGS: _.map(pathConfig.parameters, (parameter) => {
								return {
									FUNCTION_PARAM: parameter.name,
									FUNCTION_PARAM_DESCRIPTION: parameter.description || "stub"
								};
							})
						},
						FUNCTION_PAYLOAD: getRequestPayloadType(pathConfig.requestBody),
						FUNCTION_RESPONSE: getResponseType(pathConfig.responses["200"]),
						REQUEST_METHOD: pathConfig.method,
						REQUEST_PATH: transformApiPath(pathConfig.path, pathConfig.parameters),
						// Currently only supporting one query param.
						REQUEST_QUERY: headQueryName && {
							QUERY_NAME: headQueryName,
							QUERY_VALUE_PATH: `\${params.${headQueryName}}`
						}
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
	fs.readFile("./templates/apiModelTypes.mustache", (error, data) => {
		const models = _(openApiFile.components.schemas)
			.pickBy((schema) => {
				return !schema.enum;
			})
			.map((schema, schemaName) => {
				return {
					MODEL_NAME: schemaName,
					MODEL_DESCRIPTION: schema.description,
					MODEL_PROPERTIES: _.map(schema.properties, (property, propertyName) => {
						return {
							PROPERTY_NAME: propertyName,
							MODEL_DESCRIPTION: property.description,
							PROPERTY_TYPE: translateDataType(property),
							PROPERTY_OPTIONAL: !_.includes(schema.required, propertyName),
							PROPERTY_READONLY: property.readOnly
						};
					})
				};
			})
			.value();

		const enums = _(openApiFile.components.schemas)
			.pickBy((schema) => {
				return !!schema.enum;
			})
			.map((schema, schemaName) => {
				return {
					ENUM_NAME: schemaName,
					ENUM_DESCRIPTION: schema.description,
					ENUM_ENTRIES: _.map(schema.enum, (enumEntry) => {
						return {
							ENUM_KEY: _.toUpper(_.snakeCase(enumEntry)) || enumEntry,
							ENUM_VALUE: schema.type === "string" ? `"${enumEntry}"` : enumEntry
						};
					})
				};
			})
			.value();

		const mustacheContext = {
			MODELS: models,
			ENUMS: enums
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
	fs.readFile("./templates/apiModels.mustache", (error, data) => {
		const schemas = openApiFile.components.schemas;
		const models = _(schemas)
			.pickBy((schema) => {
				return !schema.enum;
			})
			.map((schema, schemaName) => {
				return {
					MODEL_NAME: schemaName,
					MODEL_DESCRIPTION: schema.description,
					MODEL_PROPERTIES: _.map(schema.properties, (property, propertyName) => {
						return {
							PROPERTY_NAME: propertyName,
							PROPERTY_TYPE: translateFieldType(schemas, property),
							PROPERTY_OPTIONS: getEnumEntries(schemas, property),
							PROPERTY_DESCRIPTION: property.description,
							PROPERTY_UNITS: property["x-ada-units"],
							PROPERTY_FORMAT: property.format,
							PROPERTY_DEFAULT: property.default || generateDefaultValue(property),
							PROPERTY_MINIMUM: property.minimum || property.minLength,
							PROPERTY_MAXIMUM: property.maximum || property.maxLength
						};
					})
				};
			})
			.value();

		const mustacheContext = {
			MODELS: models
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
 * Locates the enum entries for a given schema.
 * If the schema is not an enum then this will return `undefined`
 * @param {array} schemas - the list of all schemas in this api.
 * @param {object} schema - the current schema to extract enum entries, if they exist.
 * @returns undefined or the object containing all enum items as the value of the key "ITEMS".
 */
function getEnumEntries(schemas, schema) {
	const enumItemsObject = {
		ITEMS: []
	};

	if (schema.enum) {
		enumItemsObject.ITEMS = schema.enum;
		return enumItemsObject;
	} else if (schema.$ref) {
		return getEnumEntries(schemas, schemas[getSchemaName(schema.$ref)]);
	} else {
		return undefined;
	}
}

/**
 * This function transforms an API path from an OpenAPI path
 * to a javascript template literal, where brace surrounded path
 * variables are turned into injections {} -> "${}".
 * And in place of the path variable names, the names are prepended with
 * the "params" object reference.
 * @param {*} request
 * @param {*} parameters
 * @returns
 */
function transformApiPath(request, parameters) {
	let apiPath = request;
	_.forEach(parameters, (parameter) => {
		apiPath = _.replace(apiPath, `{${parameter.name}}`, `\${params.${parameter.name}}`);
	});
	return apiPath;
}

/**
 *
 * @param {*} requestBody
 * @returns
 */
function getRequestPayloadType(requestBody) {
	if (!requestBody) {
		return undefined;
	}

	const contentType =
		requestBody.content["application/json"] ||
		requestBody.content["application/xml"] ||
		requestBody.content["application/x-www-form-urlencoded"] ||
		requestBody.content["text/plain"];

	return translateDataType(contentType.schema, true);
}

/**
 * Retrieves the response type for an api function.
 * @param {*} response
 * @returns the typescript data type.
 */
function getResponseType(response) {
	if (_.isEmpty(response.content)) {
		return "any";
	}

	const contentType =
		response.content["application/json"] ||
		response.content["application/xml"] ||
		response.content["application/x-www-form-urlencoded"] ||
		response.content["text/plain"];

	return translateDataType(contentType.schema, true);
}

/**
 * Extracts the name of the schema item from the open api $ref string.
 * @param {string} ref - the open api yaml $ref string.
 * @returns the name of the schema.
 */
function getSchemaName(ref) {
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
 * @param {boolean} isForeignReference - flag to indicate whether this is for a foreign file.
 * @returns typescript data type.
 */
function translateDataType(schema, isForeignReference = false) {
	let propertyType;

	console.log(schema);

	if (!schema.type && schema.$ref) {
		propertyType = _.join(
			[isForeignReference ? "ApiModelTypes." : undefined, getSchemaName(schema.$ref)],
			""
		);
	} else if (schema.enum) {
		// assumption that enums are handled outside of this context.
		propertyType = "any";
	} else if (schema.oneOf) {
		const types = _.map(schema.oneOf, (these) => {
			return translateDataType(these, isForeignReference);
		});
		propertyType = _.join(types, " | ");
	} else if (schema.type === "integer") {
		propertyType = "number";
	} else if (schema.type === "array") {
		if (!schema.items.type) {
			propertyType = `Array<${translateDataType(schema.items, isForeignReference)}>`;
		} else {
			const fullTypePath =
				getSchemaName(schema.items.$ref) &&
				_.join(
					[
						isForeignReference ? "ApiModelTypes." : undefined,
						getSchemaName(schema.items.$ref)
					],
					""
				);

			propertyType = `Array<${fullTypePath || schema.items.type}>`;
		}
	} else if (schema.type === "boolean") {
		propertyType = "boolean";
	} else if (schema.type === "object") {
		propertyType = "Record<string, unknown>";
	} else {
		propertyType = schema.type;
	}

	return propertyType;
}

/**
 * Translates a data type from OpenAPI to a FieldType string. This is used specifically for API
 * models (the runtime representation of the associated typescript interface).
 * For more info on OpenAPI data types https://swagger.io/docs/specification/data-models/data-types/
 * @param {array} schemas - the list of all schemas in this file.
 * @param {object} schema - the current schema to be translated.
 * @returns a field type for a field config.
 */
function translateFieldType(schemas, schema) {
	let fieldType;

	if (!schema.type && schema.$ref) {
		const externalSchema = schemas[getSchemaName(schema.$ref)];
		fieldType = translateFieldType(schemas, externalSchema);
	} else if (schema.enum) {
		fieldType = "ENUM";
	} else if (schema.type === "integer" || schema.type === "number") {
		fieldType = "NUMBER";
	} else if (schema.type === "array") {
		fieldType = "ARRAY";
	} else if (schema.type === "object") {
		fieldType = "OBJECT";
	} else if (schema.type === "string") {
		fieldType = "STRING";
	} else if (schema.type === "boolean") {
		fieldType = "BOOLEAN";
	} else {
		fieldType = "UNDEFINED";
	}

	return fieldType;
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
