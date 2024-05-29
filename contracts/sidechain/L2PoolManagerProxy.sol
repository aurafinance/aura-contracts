// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { NonblockingLzApp } from "../layerzero/lzApp/NonblockingLzApp.sol";
import { IPoolManagerLite } from "contracts/sidechain/interfaces/IPoolManagerLite.sol";

/**
 * @title   L2PoolManagerProxy
 * @author  AuraFinance
 * @dev     Given a root gauge on L1PoolManagerProxy it adds a gauge recipient on PoolManagerLite
 */
contract L2PoolManagerProxy is NonblockingLzApp {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */
    /// @dev The poolManager address
    address public poolManager;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */
    event PoolManagerUpdated(address poolManager);

    /**
     * Initialize the contract.
     * @param _lzEndpoint LayerZero endpoint contract
     * @param _poolManager   Pool Manager address
     */
    function initialize(address _lzEndpoint, address _poolManager) external onlyOwner {
        _initializeLzApp(_lzEndpoint);
        _setPoolManager(_poolManager);
    }

    function setPoolManager(address _poolManager) external onlyOwner {
        _setPoolManager(_poolManager);
    }

    /**
     * @notice sets the poolManager operator.
     * @dev Usefull to reset pool manager operator value.
     */
    function setPoolManagerOperator(address _operator) external onlyOwner {
        require(address(0) != _operator, "!_operator");
        IPoolManagerLite(poolManager).setOperator(_operator);
    }

    /**
     * @notice Adds new pool.
     * @param _gauge The gauge address.
     */
    function addPool(address _gauge) external onlyOwner returns (bool) {
        return _addPool(_gauge);
    }

    /**
     * @notice Shutdowns a given pool.
     * @param _pid The pool id.
     */
    function shutdownPool(uint256 _pid) external onlyOwner returns (bool) {
        return IPoolManagerLite(poolManager).shutdownPool(_pid);
    }

    /**
     * @notice Shutdows the system, it is not reversible.
     */
    function shutdownSystem() external onlyOwner {
        IPoolManagerLite(poolManager).shutdownSystem();
    }

    function _addPool(address _gauge) internal returns (bool) {
        return IPoolManagerLite(poolManager).addPool(_gauge);
    }

    function _setPoolManager(address _poolManager) internal {
        poolManager = _poolManager;
        emit PoolManagerUpdated(_poolManager);
    }

    function isShutdown() external view returns (bool) {
        return IPoolManagerLite(poolManager).isShutdown();
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L1 -> L2
    ------------------------------------------------------------------- */

    /**
     * @dev Override the default lzReceive function logic
     *  Called by  L1PoolManager.addPool, allows
     */
    function _nonblockingLzReceive(
        uint16, /** _srcChainId */
        bytes memory,
        uint64,
        bytes memory _payload
    ) internal virtual override {
        address gauge = abi.decode(_payload, (address));
        require(_addPool(gauge), "!addPool");
    }
}
