// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Create2 } from "@openzeppelin/contracts-0.8/utils/Create2.sol";

/**
 * @title Create2Factory
 * @author  AuraFinance
 * @notice  Deploy contracts using CREATE2 opcode.
 * @dev A factory contract that uses the CREATE2 opcode to deploy contracts with a deterministic address.
 */
contract Create2Factory {
    /**
     * @dev Event emitted when a contract is successfully deployed.
     * @param salt A unique value used as part of the computation to determine the address where the contract will be deployed.
     * @param deployed The address where the contract has been deployed.
     */
    event Deployed(bytes32 indexed salt, address deployed);

    /**
     * @notice Deploys a contract using the CREATE2 opcode.
     * @param amount The amount of Ether to be sent with the transaction deploying the contract.
     * @param salt A unique value used as part of the computation to determine the address where the contract will be deployed.
     * @param bytecode The bytecode that will be used to create the contract.
     * @return The address where the contract has been deployed.
     */
    function _deploy(
        uint256 amount,
        bytes32 salt,
        bytes memory bytecode
    ) internal returns (address) {
        address deployedAddress;

        deployedAddress = Create2.deploy(amount, salt, bytecode);
        emit Deployed(salt, deployedAddress);

        return deployedAddress;
    }

    /**
     * @notice Deploys a contract using the CREATE2 opcode.
     * @param amount The amount of Ether to be sent with the transaction deploying the contract.
     * @param salt A unique value used as part of the computation to determine the address where the contract will be deployed.
     * @param bytecode The bytecode that will be used to create the contract.
     * @return The address where the contract has been deployed.
     */
    function deploy(
        uint256 amount,
        bytes32 salt,
        bytes calldata bytecode
    ) external returns (address) {
        return _deploy(amount, salt, bytecode);
    }

    function computeAddress(bytes32 salt, bytes32 codeHash) external view returns (address) {
        return Create2.computeAddress(salt, codeHash);
    }

    /**
     *
     *@dev Fallback function that accepts Ether.
     */
    receive() external payable {}
}
