// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { IERC20 } from "@openzeppelin/contracts-0.8/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts-0.8/access/Ownable.sol";
import { AuraMath } from "../AuraMath.sol";

interface ILiquidityBootstrap {
    event EventStarted(uint256 outTokens, uint256 inToOutRatio);
    event EventEnded();
    event LiquidityAdded(address funder, uint256 amount);
    event StreamClaimed(address claimer, uint256 amount, bool locked);

    function initialise(uint256 _outTokens) external;

    function end() external;

    function addLiquidity(
        uint256 _inAmount,
        bytes32[] calldata /* _proof */
    ) external;

    function claim(bool _lock) external;

    function availableClaim(address _user) external view returns (uint256);
}

contract MockLiquidityBootstrap is ILiquidityBootstrap, Ownable {
    using AuraMath for uint256;

    address public immutable inToken;
    address public immutable outToken;

    // out = inAmount * inToOutRatio / 1e18
    uint256 public immutable inToOutRatio;

    bytes32 public merkleRoot;
    mapping(address => bool) public hasClaimed;
    uint256 public immutable whitelistCap;

    uint256 public remainingOutTokens;
    uint256 public startTime;
    uint256 public endTime;
    uint256 public constant streamLength = 26 weeks;

    struct Stream {
        uint224 total;
        uint32 lastClaim;
    }
    mapping(address => Stream) public userStreams;

    constructor(
        address _inToken,
        address _outToken,
        uint256 _inToOutRatio,
        bytes32 _merkleRoot,
        uint256 _whitelistCap
    ) Ownable() {
        inToken = _inToken;
        outToken = _outToken;
        inToOutRatio = _inToOutRatio;
        merkleRoot = _merkleRoot;
        whitelistCap = _whitelistCap;
    }

    // start
    function initialise(uint256 _outTokens) external override onlyOwner {
        require(startTime == 0, "Already started");

        IERC20(outToken).transferFrom(msg.sender, address(this), _outTokens);
        remainingOutTokens = _outTokens;
        startTime = block.timestamp;

        emit EventStarted(_outTokens, inToOutRatio);
    }

    // finish
    function end() external override onlyOwner {
        require(endTime == 0, "Already done");
        require(startTime != 0 && block.timestamp > (startTime + 6 days), "Not enough time elapsed");

        IERC20(inToken).transfer(msg.sender, IERC20(inToken).balanceOf(address(this)));
        IERC20(outToken).transfer(msg.sender, remainingOutTokens);

        endTime = block.timestamp + 1 hours;

        emit EventEnded();
    }

    // TODO - apply proof & hasClaimed
    // TODO - limit to whitelist && 15k before
    // addLiquidity
    function addLiquidity(
        uint256 _inAmount,
        bytes32[] calldata /* _proof */
    ) external override {
        require(endTime == 0, "Already done");
        require(startTime != 0, "Not started");

        // e.g. 5e18 * 1000e18 / 1e18 = 5000e18
        uint256 outAmount = (_inAmount * inToOutRatio) / 1e18;

        require(remainingOutTokens > outAmount, "Not enough liquidity remaining");
        require(whitelistCap > outAmount, "Exceeds whitelist cap");

        IERC20(inToken).transferFrom(msg.sender, address(this), _inAmount);
        remainingOutTokens -= outAmount;

        // add stream
        userStreams[msg.sender].total += outAmount.to224();

        emit LiquidityAdded(msg.sender, _inAmount);
    }

    function claim(bool _lock) external override {
        uint256 available = availableClaim(msg.sender);

        require(available > 0, "Nothing to claim");

        userStreams[msg.sender].lastClaim = block.timestamp.to32();
        IERC20(outToken).transfer(msg.sender, available);

        emit StreamClaimed(msg.sender, available, _lock);
    }

    function availableClaim(address _user) public view override returns (uint256) {
        require(block.timestamp > endTime, "Streams not started");

        Stream memory stream = userStreams[_user];
        if (stream.total == 0) return 0;

        uint256 lastClaimTime = stream.lastClaim == 0 ? endTime : stream.lastClaim;
        uint256 timeElapsed = block.timestamp - lastClaimTime;
        uint256 rate = stream.total / streamLength;
        return rate * timeElapsed;
    }
}
