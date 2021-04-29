const https = require("https");

exports.download = (url) => {
	return new Promise((resolve, reject) => {
		https
			.get(url, function (response) {
				let body = "";
				let i = 0;
				response.on("data", function (chunk) {
					i++;
					body += chunk;
				});
				response.on("end", function () {
					resolve(body);
				});
			})
			.on("error", (error) => {
				reject(error);
			});
	});
};
