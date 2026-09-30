import { communityFor, communityView } from './community.js';
import { editGuide } from './guide.js';

export function installCommunityRoutes(app,options){
  const service=communityFor(options),{operations,guard}=options;
  app.get('/api/community',(_req,res)=>res.json(communityView(operations)));
  app.get('/api/community-options',async(_req,res,next)=>{try{res.json(await options.discord.communityOptions());}catch{next(Error('Discord 연결과 채널 권한을 확인해 주세요.'));}});
  const actions={settings:b=>service.settings(b),draft:b=>service.draft(b),publish:b=>service.publish(b),resolve:b=>service.resolve(b),'delete-draft':b=>service.removeDraft(b),answer:b=>service.answer(b),panel:()=>service.panel(),guide:async b=>{guard();await operations.update(s=>{editGuide(s,'draft',{key:b.key,content:b.content,expectedRevision:b.guideRevision});editGuide(s,'publish',{key:b.key,expectedRevision:s.guide.revision});});}};
  app.post('/api/community/:action',async(req,res,next)=>{try{if(!Object.hasOwn(actions,req.params.action))throw Error('지원하지 않는 작업입니다.');await actions[req.params.action](req.body);res.json(communityView(operations));}catch(e){next(e);}});
  return service;
}
