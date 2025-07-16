"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const codesign_1 = require("../common/codesign");
const publish_1 = require("../common/publish");
async function main() {
    const esrpCliDLLPath = (0, publish_1.e)('EsrpCliDllPath');
    // Start the code sign processes in parallel
    // 1. Codesign deb package
    // 2. Codesign rpm package
    const codesignTask1 = (0, codesign_1.spawnCodesignProcess)(esrpCliDLLPath, 'sign-pgp', '.build/linux/deb', '*.deb');
    const codesignTask2 = (0, codesign_1.spawnCodesignProcess)(esrpCliDLLPath, 'sign-pgp', '.build/linux/rpm', '*.rpm');
    // Additional codesign processes with the newer key
    const codesignTask3 = (0, codesign_1.spawnCodesignProcess)(esrpCliDLLPath, 'sign-pgp-500207', '.build/linux/deb-500207', '*.deb');
    const codesignTask4 = (0, codesign_1.spawnCodesignProcess)(esrpCliDLLPath, 'sign-pgp-500207', '.build/linux/rpm-el10', '*.rpm');
    // Codesign deb package
    (0, codesign_1.printBanner)('Codesign deb package');
    await (0, codesign_1.streamProcessOutputAndCheckResult)('Codesign deb package', codesignTask1);
    // Codesign rpm package
    (0, codesign_1.printBanner)('Codesign rpm package');
    await (0, codesign_1.streamProcessOutputAndCheckResult)('Codesign rpm package', codesignTask2);
    // Codesign deb package with the newer key
    (0, codesign_1.printBanner)('Codesign deb package (sign-pgp-500207)');
    await (0, codesign_1.streamProcessOutputAndCheckResult)('Codesign deb package (sign-pgp-500207)', codesignTask3);
    // Codesign rpm package with the newer key
    (0, codesign_1.printBanner)('Codesign rpm package (sign-pgp-500207)');
    await (0, codesign_1.streamProcessOutputAndCheckResult)('Codesign rpm package (sign-pgp-500207)', codesignTask4);
}
main().then(() => {
    process.exit(0);
}, err => {
    console.error(`ERROR: ${err}`);
    process.exit(1);
});
//# sourceMappingURL=codesign.js.map