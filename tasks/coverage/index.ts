import { task, subtask } from "hardhat/config";
import { TaskArguments, RunSuperFunction, HardhatRuntimeEnvironment } from "hardhat/types";
import fs from "fs-extra";
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

subtask("coverage:clean")
    .addOptionalParam("externalSrc", "External smart contracts paths separeted by ','", "/convex-platform")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment, _: RunSuperFunction<any>) {
        // Delete temporary external sources from code base.
        const sources = taskArgs.externalSrc.split(",");
        console.log("🚀 ~ file: index.ts ~ line 24 ~ externalSrc", taskArgs.externalSrc)
        for (let i = 0; i < sources.length; i++) {
            fs.rmdirSync(hre.config.paths.sources + sources[i], { recursive: true });
        }
    });

subtask("coverage:setup")
    .addOptionalParam("externalSrc", "External smart contracts paths separeted by ','", "/convex-platform/contracts/contracts")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment, _: RunSuperFunction<any>) {
        // Copy external sources to the hre config path source directory.
        const sources = taskArgs.externalSrc.split(",");
        for (let i = 0; i < sources.length; i++) {
            await copyExternalSrc(hre, sources[i]);
        }
    });

task("coverage:externalSrc")
    .addOptionalParam("externalSrc", "External smart contracts paths separeted by ','", "/convex-platform/contracts/contracts")
    .addOptionalParam("testfiles", "test/**/*.ts")
    .addOptionalParam("solcoverjs", "./.solcover.js")
    .addOptionalParam('temp', "artifacts")
    .setAction(async function (taskArgs: TaskArguments, hre: HardhatRuntimeEnvironment, runSuper: RunSuperFunction<any>) {
        const { testfiles, solcoverjs, temp } = taskArgs;
        await hre.run("coverage:setup", { externalSrc: taskArgs.externalSrc });
        await hre.run("coverage", { testfiles, solcoverjs, temp });
        await hre.run("coverage:clean", { externalSrc: taskArgs.externalSrc });
    });