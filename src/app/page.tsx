import Link from 'next/link';
import { InstallPrompt } from '../components/website/install-prompt';
import { GpuHeroBackground } from '../components/website/gpu-hero-background';
import { SplineHeroScene } from '../components/website/spline-hero-scene';
import { HeroMotion } from '../components/website/hero-motion';
import { MotionReveal, ParallaxStage } from '../components/website/motion-reveal';

const steps = [
  { number: '01', title: '캡처를 올려요', text: 'JPG, PNG, WebP 이미지를 최대 3장까지 선택하세요.' },
  { number: '02', title: '작품을 찾아요', text: '이미지 속 일본어와 장면 단서를 바탕으로 후보를 좁혀요.' },
  { number: '03', title: '한국 정보를 확인해요', text: '일본 원제, 발음, 한국어 제목과 정발 여부를 보여드려요.' },
];

export default function WebsiteHomePage() {
  return (
    <main className="site-shell">
      <a className="skip-link" href="#site-title">본문으로 건너뛰기</a>
      <header className="site-nav">
        <Link className="brand" href="/">MangaFind</Link>
        <nav aria-label="주요 메뉴"><a href="#how-it-works">찾는 방법</a><a href="#result-example">결과 예시</a><InstallPrompt className="nav-cta" label="설치하기" /></nav>
      </header>
      <section className="site-hero" aria-labelledby="site-title">
        <GpuHeroBackground />
        <SplineHeroScene />
        <HeroMotion>
          <div className="site-hero-copy">
            <p className="site-eyebrow" data-hero-block>Manga identification for the moments you save</p>
            <h1 id="site-title" data-hero-block><span data-hero-word>이 </span><span data-hero-word>만화, </span><span data-hero-word>뭐였지?</span></h1>
            <p className="site-lede" data-hero-block><span data-hero-word>SNS에서 </span><span data-hero-word>발견한 </span><span data-hero-word>일본 </span><span data-hero-word>만화를 </span><br /><span data-hero-word>캡처 </span><span data-hero-word>한 </span><span data-hero-word>장으로 </span><span data-hero-word>찾아보세요.</span></p>
            <div className="site-actions" data-hero-block><Link className="site-primary-cta" href="/search">이미지로 만화 찾기 <span aria-hidden="true">↗</span></Link><a className="site-text-cta" href="#how-it-works">어떻게 찾는지 보기</a></div>
          </div>
        </HeroMotion>
        <ParallaxStage><div className="search-story hero-story-sequence" aria-label="이미지에서 만화 제목을 찾는 과정"><div className="story-image-card"><span className="story-tag">your screenshot</span><div className="manga-frame manga-frame-top"><span>薫る花は</span><strong>凛と咲く</strong></div><span className="story-caption">장면 캡처</span></div><div className="story-line" aria-hidden="true"><span>image clue</span><i>↓</i></div><div className="story-result-card"><span className="story-tag">identified</span><p>薫る花は凛と咲く</p><strong>향기로운 꽃은 늠름하게 핀다</strong><small>정식 제목 · 정발 확인</small></div></div></ParallaxStage>
      </section>
      <MotionReveal variant="slice"><section className="situation-band" aria-labelledby="situation-title"><p className="site-eyebrow">For the scene you saved</p><h2 id="situation-title">제목을 놓친 장면은<br /><em>생각보다 자주 남아요.</em></h2><div className="situation-grid"><p>짧은 영상에서 스쳐간 한 컷</p><p>일본어 대사만 남은 캡처</p><p>제목 없이 공유된 장면</p></div></section></MotionReveal>
      <MotionReveal><section className="steps-section" id="how-it-works" aria-labelledby="steps-title"><div className="section-intro"><p className="site-eyebrow">A shorter route to the title</p><h2 id="steps-title">캡처에서 제목까지,<br />세 단계면 충분해요.</h2></div><div className="steps-grid">{steps.map((step, index) => <article className="step-item" key={step.number} style={{ '--step-delay': `${index * 90}ms` } as React.CSSProperties}><span>{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>)}</div></section></MotionReveal>
      <MotionReveal variant="drift"><section className="result-example" id="result-example" aria-labelledby="example-title"><div className="section-intro"><p className="site-eyebrow">A result that stays simple</p><h2 id="example-title">찾고 싶은 정보만<br />한 화면에 담아요.</h2></div><div className="example-result-card"><span className="example-label">일본어 원제</span><h3>薫る花は凛と咲く</h3><p className="example-pronunciation">Kaoru Hana wa Rin to Saku</p><div className="example-korean"><span>한국어 정보</span><strong>향기로운 꽃은 늠름하게 핀다</strong><p>정식 제목 <b>·</b> 정발 확인</p></div></div></section></MotionReveal>
      <MotionReveal><section className="privacy-band" aria-labelledby="privacy-title"><div><p className="site-eyebrow">Built for a quick search</p><h2 id="privacy-title">이미지는 찾는 데만 사용해요.</h2></div><p>업로드한 이미지는 외부 AI 분석에 사용될 수 있으며, 처리 후 원본을 서버에 영구 저장하지 않습니다. 결과는 현재 브라우저 세션에서만 확인할 수 있어요.</p></section></MotionReveal>
      <MotionReveal variant="slice"><section className="install-band" aria-labelledby="install-title"><p className="site-eyebrow">Keep MangaFind close</p><h2 id="install-title">다음 장면은<br />더 빠르게 찾아보세요.</h2><div className="install-actions"><InstallPrompt /><Link className="site-text-cta" href="/search">검색 화면 열기</Link></div></section></MotionReveal>
      <footer className="site-footer"><span className="brand">MangaFind</span><span>일본 만화 캡처 검색</span><Link href="/search">검색 시작</Link></footer>
    </main>
  );
}
