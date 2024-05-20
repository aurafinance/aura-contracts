// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { NonblockingLzApp } from "../layerzero/lzApp/NonblockingLzApp.sol";

interface IPoolManager {
    function setOperator(address _operator) external;

    function addPool(address _gauge) external returns (bool);

    function shutdownPool(uint256 _pid) external returns (bool);

    function shutdownSystem() external;

    function isShutdown() external view returns (bool);
}

/**
 * @title   L2PoolManagerProxy
 * @author  AuraFinance
 * @dev     Given a root gauge on L1PoolManager it adds a gauge recipient on PoolManagerLite
 */
contract L2PoolManagerProxy is NonblockingLzApp {
    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */
    /// @dev The poolManager address
    address public poolManager;
    /// @dev Indicates if add pool is protected or not.
    bool public protectAddPool;

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
     * @notice set if addPool is only callable by owner
     */
    function setProtectPool(bool _protectAddPool) external onlyOwner {
        protectAddPool = _protectAddPool;
    }

    /**
     * @notice sets the poolManager operator.
     * @dev Usefull to reset pool manager operator value.
     */
    function setPoolManagerOperator(address _operator) external onlyOwner {
        require(address(0) != _operator, "!_operator");
        IPoolManager(poolManager).setOperator(_operator);
    }

    /**
     * @notice Adds new pool.
     * @param _gauge The gauge address.
     */
    function addPool(address _gauge) external returns (bool) {
        return _addPool(_gauge);
    }

    /**
     * @notice Shutdowns a given pool.
     * @param _pid The pool id.
     */
    function shutdownPool(uint256 _pid) external onlyOwner returns (bool) {
        return IPoolManager(poolManager).shutdownPool(_pid);
    }

    /**
     * @notice Shutdows the system, it is not reversible.
     */
    function shutdownSystem() external onlyOwner {
        IPoolManager(poolManager).shutdownSystem();
    }

    function _addPool(address _gauge) internal returns (bool) {
        if (protectAddPool) {
            require(msg.sender == owner(), "!auth");
        }
        return IPoolManager(poolManager).addPool(_gauge);
    }

    function _setPoolManager(address _poolManager) internal {
        poolManager = _poolManager;
        emit PoolManagerUpdated(_poolManager);
    }

    function isShutdown() external view returns (bool) {
        return IPoolManager(poolManager).isShutdown();
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
        address gauge = abi.decode(_payload, (address));
        require(_addPool(gauge), "!addPool");
    }
}
