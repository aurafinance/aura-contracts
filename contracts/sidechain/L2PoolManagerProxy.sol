// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { NonblockingLzApp } from "../layerzero/lzApp/NonblockingLzApp.sol";
import { IPoolManagerLite } from "contracts/sidechain/interfaces/IPoolManagerLite.sol";
import { KeeperRole } from "../peripheral/KeeperRole.sol";

/**
 * @title   L2PoolManagerProxy
 * @author  AuraFinance
 * @dev     Given a root gauge on L1PoolManagerProxy it adds a gauge recipient on PoolManagerLite
 */
contract L2PoolManagerProxy is NonblockingLzApp, KeeperRole {
    /* -------------------------------------------------------------------
       Storage
    ------------------------------------------------------------------- */

    /// @dev The poolManager address
    address public poolManager;
    /// @dev Mapping of valid gauges sent from L1
    mapping(address => bool) public isValidGauge;

    /* -------------------------------------------------------------------
       Events
    ------------------------------------------------------------------- */

    event PoolManagerUpdated(address poolManager);

    /* -------------------------------------------------------------------
       Initialize/Constructor
    ------------------------------------------------------------------- */

    constructor() KeeperRole(msg.sender) {}

    /**
     * Initialize the contract.
     * @param _lzEndpoint LayerZero endpoint contract
     * @param _poolManager   Pool Manager address
     */
    function initialize(address _lzEndpoint, address _poolManager) external onlyOwner {
        _initializeLzApp(_lzEndpoint);
        _setPoolManager(_poolManager);
    }

    /* -------------------------------------------------------------------
       View functions
    ------------------------------------------------------------------- */

    function isShutdown() external view returns (bool) {
        return IPoolManagerLite(poolManager).isShutdown();
    }

    /* -------------------------------------------------------------------
       Setter functions
    ------------------------------------------------------------------- */

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

    /* -------------------------------------------------------------------
       Core functions
    ------------------------------------------------------------------- */

    /**
     * @notice Adds new pool directly on L2.
     * @param _gauge The gauge address.
     */
    function addPool(address _gauge) external onlyKeeper returns (bool) {
        require(isValidGauge[_gauge], "!valid");
        return IPoolManagerLite(poolManager).addPool(_gauge);
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

    /* -------------------------------------------------------------------
       Internal functions
    ------------------------------------------------------------------- */

    function _setPoolManager(address _poolManager) internal {
        poolManager = _poolManager;
        emit PoolManagerUpdated(_poolManager);
    }

    /* -------------------------------------------------------------------
      Layer Zero functions L1 -> L2
    ------------------------------------------------------------------- */

    /**
     * @dev Override the default lzReceive function logic
     *  Called by  L1PoolManager.addPool
     */
    function _nonblockingLzReceive(
        uint16, /** _srcChainId */
        bytes memory,
        uint64,
        bytes memory _payload
    ) internal virtual override {
        address[] memory gauges = abi.decode(_payload, (address[]));
        uint256 payloadsLen = gauges.length;
        for (uint256 i = 0; i < payloadsLen; i++) {
            isValidGauge[gauges[i]] = true;
        }
    }
}
