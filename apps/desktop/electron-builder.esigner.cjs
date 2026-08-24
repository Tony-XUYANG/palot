const certificateSha1 = process.env.WINDOWS_SIGNING_CERT_SHA1?.trim()

if (!certificateSha1 || !/^[a-f0-9]{40}$/i.test(certificateSha1)) {
	throw new Error("SSL.com eSigner requires a 40-character WINDOWS_SIGNING_CERT_SHA1")
}

module.exports = {
	extends: "electron-builder.yml",
	win: {
		signtoolOptions: {
			certificateSha1,
			signingHashAlgorithms: ["sha256"],
			rfc3161TimeStampServer: "http://ts.ssl.com",
		},
	},
}
