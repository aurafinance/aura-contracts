// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { LzApp } from "../layerzero/lzApp/LzApp.sol";
import { SafeERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { IOFT } from "../layerzero/token/oft/IOFT.sol";
import { IBooster } from "../interfaces/IBooster.sol";
import { IStashRewardDistro } from "../interfaces/IStashRewardDistro.sol";

/**
 * @title   ChildGaugeVoteRewards
 * @author  Aura Finance
 */
contract ChildGaugeVoteRewards is LzApp {
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------------
       Storage 
    ------------------------------------------------------------------- */

    /// @dev Aura token address
    address public immutable aura;

    /// @dev The Booster contract address
    IBooster public immutable booster;

    /// @dev Extra reward distro contract
    IStashRewardDistro public immutable stashRewardDistro;

    /// @dev Distributor address
    address public distributor;

    /// @dev Epoch => Gauge => Amount to send
    mapping(uint256 => mapping(address => uint256)) public getAmountToSendByEpoch;

    /// @dev Epoch => Gauge => Amount sent
    mapping(uint256 => mapping(address => uint256)) public getAmountSentByEpoch;

    /// @dev Gauge => Pool ID
    mapping(address => uint256) public getPoolId;

    /// @dev L1 Gauge => L2 Gauge
    mapping(address => address) public getL2Gauge;

    /* -------------------------------------------------------------------
       Events 
    ------------------------------------------------------------------- */

    event SetL1Gauge(address l1Gauge, address l2Gauge);
    event SetDistributor(address distributor);

    /* -------------------------------------------------------------------
       Constructor 
    ------------------------------------------------------------------- */

    constructor(
        address _aura,
        address _booster,
        address _stashRewardDistro,
        address _lzEndpoint
    ) {
        aura = _aura;
        booster = IBooster(_booster);
        stashRewardDistro = IStashRewardDistro(_stashRewardDistro);

        _initializeLzApp(_lzEndpoint);
    }

    /* -------------------------------------------------------------------
       Modifiers 
    ------------------------------------------------------------------- */

    modifier onlyDistributor() {
        require(msg.sender == distributor, "!distributor");
        _;
    }

    /* -------------------------------------------------------------------
       Setters 
    ------------------------------------------------------------------- */

    function setDistributor(address _distributor) external onlyOwner {
        distributor = _distributor;
        emit SetDistributor(_distributor);
    }

    function setPoolIds(uint256[] memory _poolIds) external {
        uint256 poolIdsLen = _poolIds.length;
        for (uint256 i = 0; i < poolIdsLen; i++) {
            uint256 pid = _poolIds[i];
            IBooster.PoolInfo memory poolInfo = booster.poolInfo(pid);
            getPoolId[poolInfo.gauge] = pid;
        }
    }

    function setL1Guage(address _l1Gauge, address _l2Gauge) external onlyOwner {
        require(getPoolId[_l2Gauge] != 0, "!gauge");
        getL2Gauge[_l1Gauge] = _l2Gauge;
        emit SetL1Gauge(_l1Gauge, _l2Gauge);
    }

    /* -------------------------------------------------------------------
       Core 
    ------------------------------------------------------------------- */

    /**
     * @notice Process gauge rewards for the given epoch for mainnet
     * @param _gauge Array of gauges
     * @param _epoch The epoch
     */
    function processGaugeRewards(uint256 _epoch, address[] calldata _gauge) external onlyDistributor {
        for (uint256 i = 0; i < _gauge.length; i++) {
            address gauge = _gauge[i];

            // Send pro rate AURA to this stash
            uint256 amountToSend = _getAmountToSend(_epoch, gauge);

            // Fund the extra reward distro for the next 2 epochs
            uint256 pid = getPoolId[gauge];
            stashRewardDistro.fundPool(pid, aura, amountToSend, 2);
        }
    }

    /* -------------------------------------------------------------------
       Internal 
    ------------------------------------------------------------------- */

    function _getAmountToSend(uint256 _epoch, address _gauge) internal returns (uint256) {
        // Send pro rata AURA to the sidechain
        uint256 amountToSend = getAmountToSendByEpoch[_epoch][_gauge];
        require(amountToSend != 0, "amountToSend=0");

        // Prevent amounts from being sent multiple times
        uint256 amountSent = getAmountSentByEpoch[_epoch][_gauge];
        require(amountSent == 0, "amountSent!=0");
        getAmountSentByEpoch[_epoch][_gauge] = amountToSend;

        return amountToSend;
    }

    function _blockingLzReceive(
        uint16,
        bytes memory,
        uint64,
        bytes memory _payload
    ) internal override {
        // Decode the array of payloads
        (uint256 epoch, bytes[] memory payloads) = abi.decode(_payload, (uint256, bytes[]));
        uint256 payloadsLen = payloads.length;

        for (uint256 i = 0; i < payloadsLen; i++) {
            bytes memory payload = payloads[i];

            // Decode the single payload to get the gauge and amount to send
            (address l1Gauge, uint256 amountToSend) = abi.decode(payload, (address, uint256));
            address gauge = getL2Gauge[l1Gauge];
            getAmountToSendByEpoch[epoch][gauge] = amountToSend;
        }
    }
}
