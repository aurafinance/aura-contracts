// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface Il2Coordinator {
    function mintRate() external view returns (uint256);

    function accBalRewards() external view returns (uint256);

    function accAuraRewards() external view returns (uint256);

    function bridgeDelegate() external view returns (address);
}

interface IOFT {
    function totalSupply() external view returns (uint256);

    function circulatingSupply() external view returns (uint256);

    function paused() external view returns (bool);

    function balanceOf(address) external view returns (uint256);
}

interface IAuraBalOft {
    function vault() external view returns (address);
}

interface ILZApp {
    function lzEndpoint() external view returns (address);

    function canonicalChainId() external view returns (uint16);

    function trustedRemoteLookup(uint16) external view returns (bytes memory);
}

struct L2CoordData {
    uint256 mintRate;
    uint256 accBalRewards;
    uint256 accAuraRewards;
    uint256 auraBalance;
    address _address;
    address lzEndpoint;
    bytes trustedRemote;
}

struct AuraOftData {
    uint256 circulatingSupply;
    uint256 totalSupply;
    bool paused;
    uint256 bridgeDelegateAuraBalance;
    address _address;
    address lzEndpoint;
    bytes trustedRemote;
}

struct AuraBalOftData {
    uint256 circulatingSupply;
    uint256 totalSupply;
    bool paused;
    uint256 auraBalStrategyAuraBalOFTBalance;
    address _address;
    address lzEndpoint;
    bytes trustedRemote;
}

struct SidechainInformation {
    uint16 canonicalChainId;
    uint16 sidechainId;
    uint256 auraBalanceOf;
    uint256 auraBalBalanceOf;
    L2CoordData l2CoordData;
    AuraOftData auraOftData;
    AuraBalOftData auraBalOftData;
}

contract SidechainView {
    uint16 sidechainId;
    address public immutable l2Coordinator;
    address public immutable auraOft;
    address public immutable auraBalOft;
    address public immutable auraBalStrategy;

    constructor(
        uint16 _sidechainId,
        address _l2Coordinator,
        address _auraOft,
        address _auraBalOft,
        address _auraBalStrategy
    ) {
        sidechainId = _sidechainId;
        l2Coordinator = _l2Coordinator;
        auraOft = _auraOft;
        auraBalOft = _auraBalOft;
        auraBalStrategy = _auraBalStrategy;
    }

    function getl2CoordinatorInformation() public view returns (L2CoordData memory l2CoordData) {
        Il2Coordinator coordinator = Il2Coordinator(l2Coordinator);
        l2CoordData.mintRate = coordinator.mintRate();
        l2CoordData.accBalRewards = coordinator.accBalRewards();
        l2CoordData.accAuraRewards = coordinator.accAuraRewards();
        l2CoordData.auraBalance = IOFT(auraOft).balanceOf(l2Coordinator);
        l2CoordData._address = l2Coordinator;
        l2CoordData.lzEndpoint = ILZApp(l2Coordinator).lzEndpoint();
        l2CoordData.trustedRemote = ILZApp(l2Coordinator).trustedRemoteLookup(ILZApp(l2Coordinator).canonicalChainId());
    }

    function getAuraOftData() public view returns (AuraOftData memory auraOftData) {
        IOFT oft = IOFT(auraOft);
        auraOftData.circulatingSupply = oft.circulatingSupply();
        auraOftData.totalSupply = oft.totalSupply();
        auraOftData.paused = oft.paused();
        auraOftData.bridgeDelegateAuraBalance = oft.balanceOf(Il2Coordinator(l2Coordinator).bridgeDelegate());
        auraOftData._address = auraOft;
        auraOftData.lzEndpoint = ILZApp(auraOft).lzEndpoint();
        auraOftData.trustedRemote = ILZApp(auraOft).trustedRemoteLookup(ILZApp(l2Coordinator).canonicalChainId());
    }

    function getAuraBalOftData() public view returns (AuraBalOftData memory auraBalOftData) {
        IOFT oft = IOFT(auraBalOft);
        auraBalOftData.circulatingSupply = oft.circulatingSupply();
        auraBalOftData.totalSupply = oft.totalSupply();
        auraBalOftData.paused = oft.paused();
        auraBalOftData.auraBalStrategyAuraBalOFTBalance = IOFT(auraBalOft).balanceOf(auraBalStrategy);
        auraBalOftData._address = auraBalOft;
        auraBalOftData.lzEndpoint = ILZApp(auraBalOft).lzEndpoint();
        auraBalOftData.trustedRemote = ILZApp(auraBalOft).trustedRemoteLookup(ILZApp(l2Coordinator).canonicalChainId());
    }

    function getData() public view returns (SidechainInformation memory data) {
        data.sidechainId = sidechainId;
        data.canonicalChainId = ILZApp(l2Coordinator).canonicalChainId();
        data.l2CoordData = getl2CoordinatorInformation();
        data.auraOftData = getAuraOftData();
        data.auraBalOftData = getAuraBalOftData();
    }

    function getDataAndBalances(address account) public view returns (SidechainInformation memory data) {
        data = getData();
        data.auraBalanceOf = IOFT(auraOft).balanceOf(account);
        data.auraBalBalanceOf = IOFT(auraBalOft).balanceOf(account);
    }
}
