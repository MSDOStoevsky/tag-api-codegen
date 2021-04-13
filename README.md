# 🏷️ The T.A.G. API Code Generator 🏷️

Otherwise known as the **T**ypescript **A**PI **G**enerator!
This project aims to provide a simple single purpose generation for typescript api code and directories for front end projects. Currently using OpenApi3 specification.

## Why?

Current code generators for react and typescript output code fashioned to a specific request library. Most likely being fetch to remain agnostic to third party libraries. This situation will lead you to making changes to the code generator to either generate code with your library in mind, or add wrappers that end in promises that returns promises of promises and so on...

This library skips all that debate and creates api functions that return an object with configuration information. It won't make the API call. It just tells you _how_ to make the API call.

## Usage

`npx taggem [-m] [--monolith] [path/to/input.y(a)ml] [path/to/output/]`
This runs the generator in "monolith" mode.
This splits your api into multiple directories based on the open api `tag` assingments and
treats each tag as a servlet. It may not save your api, but it will save your eyes.

`npx taggem [-s] [--service] [path/to/input.y(a)ml] [path/to/output/]`
This runs the generator in "microservice mode" where your generated api code will be placed into a single directory of the same name as the api `title`. This ignores `tags` for further organization.

## Results

-   One or more directories (depending on how the generator was invoked) containing the a file with typescript functions that will return a configuration object detailing how to access an api resource. E.g. (assuming -\-m),
-   `exampleTagName/index.ts` - the file containing api request configuration information.
-   `exampleTagNameModelTypes.ts` - The exported typescript interfaces of open api `schema`.
-   `exampleTagNameModels.ts` - The exported runtime representation of open api `schema`.

NOTE: The code generator will **always** create another directory called `api` to store the results so be wary when wanting to set your output directory to a similar name.

## Dependencies

-   Typescript
-   Mustache
-   Lodash
-   Yargs
-   JS-Yaml
