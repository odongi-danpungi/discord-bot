import {readyCheckView,startReadyCheck,answerReadyCheck} from './ready-check.js';
export function installOperationTools({app,operations,participationQueue}){
 const queue=()=>participationQueue?.summary?.()||{entries:[]};
 app.get('/api/operation-tools',(_req,res)=>res.json({...readyCheckView({operationsState:operations.read(),queue:queue()}),undo:participationQueue?.orderUndoPreview?.()||{available:false}}));
 app.post('/api/operation-tools/ready/start',async(_req,res,next)=>{try{await startReadyCheck({operations,queue:queue()});res.json(readyCheckView({operationsState:operations.read(),queue:queue()}));}catch(e){next(e);}});
 app.post('/api/operation-tools/ready/answer',async(req,res,next)=>{try{await answerReadyCheck({operations,queue:queue(),checkId:req.body.checkId,entryId:req.body.entryId,manual:true});res.json(readyCheckView({operationsState:operations.read(),queue:queue()}));}catch(e){next(e);}});
 app.post('/api/operation-tools/ready/close',async(req,res,next)=>{try{await operations.update(state=>{if(!state.readyCheck||state.readyCheck.id!==req.body.checkId)throw Object.assign(Error('준비 확인이 변경됐습니다.'),{status:409});state.readyCheck.closedAt=Date.now();state.revision=(state.revision||0)+1;});res.json({ok:true});}catch(e){next(e);}});
 app.post('/api/operation-tools/undo',async(req,res,next)=>{try{if(!participationQueue)throw Object.assign(Error('Queue가 초기화되지 않았습니다.'),{status:503});res.json(await participationQueue.undoOrder(req.body));}catch(e){next(e);}});
}
