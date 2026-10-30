import {renderArticle} from './view.js?v=4';
export const sections=[['all','全部'],['finance','财经'],['technology','科技 / AI'],['world','国际']];
export function sectionArticles(articles=[],section='all'){
  return articles.filter(a=>section==='finance'? /经济|财经|金融|商业|投资/.test(a.category||'')||/央行|美联储|降息|加息|利率|股市|股指|A股|美股|纳斯达克|基金|债券|汇率|通胀|财报/.test(a.title||'') : section==='technology'?/科技|AI|人工智能/.test(a.category||''):section==='world'?/国际|地缘/.test(a.category||''):true);
}
export function renderFeed(edition,section='all'){
  const articles=sectionArticles(edition?.articles,section);
  return articles.length?articles.map(a=>renderArticle(a,edition.articles.indexOf(a),edition.generated_at)).join(''):'<div class="empty">本期暂无此栏目的已核验新闻。可切换到“全部”查看。</div>';
}
