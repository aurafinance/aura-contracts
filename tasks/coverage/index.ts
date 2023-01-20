import { task, subtask } from "hardhat/config";
import { TaskArguments, RunSuperFunction, HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "fs-extra";
import path from "path";
/**
 * Copy external sources to the hre config path source directory.
 *
 * @param {*} hre - the hardhat runtime environment
 * @param {*} externalSrc - The path to the external sources
 */
const copyExternalSrc = async (hre, externalSrc) => {
    const srcDir = hre.config.paths.root + externalSrc;
    const destDir = hre.config.paths.sources + externalSrc;
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copySync(srcDir, destDir);
}
const updatePathOnReport = async () => {
    const reportPath = path.resolve(__dirname, "../../coverage/lcov.info");
    const data = fs.readFileSync(reportPath, "utf8");
    const result = data.replace(/aura-contracts\/contracts\/convex-platform/g, 'aura-contracts/convex-platform');
    fs.writeFileSync(reportPath, result, "utf8");
}

subtask("coverage:clean")
    .addOptionalParam("externalSrc", "External smart contracts paths separated by ','", "/convex-platform")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment, _: RunSuperFunction<any>) {
        // Delete temporary external sources from code base.
        const sources = taskArgs.externalSrc.split(",");
        for (let i = 0; i < sources.length; i++) {
            fs.rmdirSync(hre.config.paths.sources + sources[i], { recursive: true });
        }
    });

subtask("coverage:setup")
    .addOptionalParam("externalSrc", "External smart contracts paths separated by ','", "/convex-platform/contracts/contracts")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment, _: RunSuperFunction<any>) {
        // Copy external sources to the hre config path source directory.
        const sources = taskArgs.externalSrc.split(",");
        for (let i = 0; i < sources.length; i++) {
            await copyExternalSrc(hre, sources[i]);
        }
    });

task("coverage:externalSrc")
    .addOptionalParam("externalSrc", "External smart contracts paths separated by ','", "/convex-platform/contracts/contracts")
    .addOptionalParam("testfiles", "test/**/*.ts")
    .addOptionalParam("solcoverjs", "./.solcover.js")
    .addOptionalParam('temp', "artifacts")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment, runSuper: RunSuperFunction<any>) {
        const { testfiles, solcoverjs, temp } = taskArgs;
        await hre.run("coverage:setup", { externalSrc: taskArgs.externalSrc });
        await hre.run("coverage", { testfiles, solcoverjs, temp });
        await updatePathOnReport();
        await hre.run("coverage:clean", { externalSrc: taskArgs.externalSrc });
    });