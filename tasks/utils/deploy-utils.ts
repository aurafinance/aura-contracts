import { Contract, ContractFactory, ContractReceipt, ContractTransaction, Overrides } from "ethers";
import { formatUnits } from "@ethersproject/units";

export const deployContract = async <T extends Contract>(
    contractFactory: ContractFactory,
    contractName = "Contract",
    constructorArgs: Array<unknown> = [],
    overrides: Overrides = {},
    debug = true,
): Promise<T> => {
    const contract = (await contractFactory.deploy(...constructorArgs, overrides)) as T;
    if (debug) {
        console.log(
            `\nDeploying ${contractName} contract with hash ${contract.deployTransaction.hash} from ${
                contract.deployTransaction.from
            } with gas price ${contract.deployTransaction.gasPrice?.toNumber() || 0 / 1e9} Gwei`,
        );
    }
    const receipt = await contract.deployTransaction.wait(debug ? 3 : undefined);
    const txCost = receipt.gasUsed.mul(contract.deployTransaction.gasPrice || 0);
    const abiEncodedConstructorArgs = contract.interface.encodeDeploy(constructorArgs);

    if (debug) {
        console.log(
            `\nDeployed ${contractName} to ${contract.address} in block ${receipt.blockNumber}, using ${
                receipt.gasUsed
            } gas costing ${formatUnits(txCost)} ETH`,
        );
        console.log(`ABI encoded args: ${abiEncodedConstructorArgs.slice(2)}`);
    }
    return contract;
};

export const logTxDetails = async (tx: ContractTransaction, method: string): Promise<ContractReceipt> => {
    console.log(
        `Sent ${method} transaction with hash ${tx.hash} from ${tx.from} with gas price ${
            tx.gasPrice?.toNumber() || 0 / 1e9
        } Gwei`,
    );
    const receipt = await tx.wait();

    // Calculate tx cost in Wei
    const txCost = receipt.gasUsed.mul(tx.gasPrice ?? 0);
    console.log(
        `Processed ${method} tx in block ${receipt.blockNumber}, using ${receipt.gasUsed} gas costing ${formatUnits(
            txCost,
        )} ETH`,
    );

    return receipt;
};
