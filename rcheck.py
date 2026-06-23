import json,subprocess
PET="0xf6ed2a53f311352c869e268601aae5b78b9a9650"
def rpc(m,p):
    out=subprocess.run(["curl","-s","--max-time","40","-X","POST","https://api.mainnet.abs.xyz",
        "-H","content-type: application/json","-d",json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p})],
        capture_output=True,text=True).stdout
    return json.loads(out).get("result")
RESOLVED="0xfd6f2ec0d5b0c729a44291652465b5fbd261acb855f8980662e847fb5a7f7469"
latest=int(rpc("eth_blockNumber",[]),16)
logs=rpc("eth_getLogs",[{"address":PET,"fromBlock":hex(latest-4000),"toBlock":hex(latest),"topics":[[RESOLVED]]}])
def w(d): h=d[2:]; return [int(h[i:i+64],16) for i in range(0,len(h),64)]
def tid(t): return int(t,16)
l=logs[-1]; rid=tid(l["topics"][1]); ws=w(l["data"])
# offsets at ws[0..3]; first array=finishOrder, second=finishTimes
def arr(off):
    i=off//32; n=ws[i]; return ws[i+1:i+1+n]
order=arr(ws[0]); times=arr(ws[2])
print("race",rid,"finishOrder(pets)=",order)
print("           finishTimesMs   =",times)
rest=subprocess.run(["curl","-s","--max-time","15","-H","accept: application/json",
    f"https://gigaverse.io/api/racing/race/{rid}"],capture_output=True,text=True).stdout
j=json.loads(rest)
print("REST finalRanking=",j.get("finalRanking"),"finishTimes=",j.get("finishTimes"),"raceTemp=",j.get("raceTemp"),"entryFee=",j.get("entryFee"))
