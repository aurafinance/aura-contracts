// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { Create2 } from "@openzeppelin/contracts-0.8/utils/Create2.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";

/**
 * @title   Create2Factory
 * @author  AuraFinance
 * @notice  Deploy contracts using CREATE2 opcode.
 * @dev     A factory contract that uses the CREATE2 opcode to deploy contracts with a deterministic address.
 */
contract Create2Factory is Ownable {
    /**
     * @dev Event emitted when a contract is successfully deployed.
     * @param salt A unique value used as part of the computation to determine the contract's address.
     * @param deployed The address where the contract has been deployed.
     */
    event Deployed(bytes32 indexed salt, address deployed);

    // mapping to track which addresses can deploy contracts.
    mapping(address => bool) public deployer;

    /**
     * @dev Throws error if called by any account other than the deployer.
     */
    modifier onlyDeployer() {
        require(deployer[msg.sender], "!deployer");
        _;
    }

    /**
     * @notice Adds or remove an address from the deployers' whitelist
     * @param _deployer address of the authorized deployer
     * @param _authorized Whether to add or remove deployer
     */
    function updateDeployer(address _deployer, bool _authorized) external onlyOwner {
        deployer[_deployer] = _authorized;
    }

    /**
     * @notice Deploys a contract using the CREATE2 opcode.
     * @param amount The amount of Ether to be sent with the transaction deploying the contract.
     * @param salt A unique value used as part of the computation to determine the contract's address.
     * @param bytecode The bytecode that will be used to create the contract.
     * @param callbacks Callbacks to execute after contract is created.
     * @return The address where the contract has been deployed.
     */
    function deploy(
        uint256 amount,
        bytes32 salt,
        bytes calldata bytecode,
        bytes[] calldata callbacks
    ) external onlyDeployer returns (address) {
        address deployedAddress = Create2.deploy(amount, salt, bytecode);
        uint256 len = callbacks.length;
        if (len > 0) {
            for (uint256 i = 0; i < len; i++) {
                _execute(deployedAddress, callbacks[i]);
            }
        }

        emit Deployed(salt, deployedAddress);

        return deployedAddress;
    }

    function _execute(address _to, bytes calldata _data) private returns (bool, bytes memory) {
        (bool success, bytes memory result) = _to.call(_data);
        require(success, "!success");

        return (success, result);
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
