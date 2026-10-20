package io.github.spssearch;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.content.res.Configuration;
import android.os.Build;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.regex.Pattern;

/** SPS Search for Android: a small browser with tabs and an address bar. The SPS Search site is the home page. */
public class MainActivity extends Activity {
    static final String SITE_URL = "https://8493834.github.io/search/";
    // Colours follow the phone's light/dark setting (set in onCreate).
    int INK, BAR, TAB_ON, TAB_OFF;
    static final Pattern HOSTLIKE = Pattern.compile("^[\\w-]+(\\.[\\w-]+)+(:\\d+)?([/?#]\\S*)?$");

    static class Tab {
        WebView web;
        String title = "New tab";
        boolean popup;      // opened by a page; checked once so the sign-in link can go to the real browser
        boolean checked;
    }

    /** A button drawn with lines, so it never depends on fonts or emoji glyphs. */
    static class Icon extends View {
        static final int BACK = 0, FWD = 1, RELOAD = 2, HOME = 3, PLUS = 4, CLOSE = 5;
        final int kind;
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        final float dp;
        Icon(android.content.Context c, int kind, int color, float dp) {
            super(c);
            this.kind = kind;
            this.dp = dp;
            paint.setColor(color);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2f * dp);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            setClickable(true);
            setFocusable(true);
        }
        @Override protected void onMeasure(int w, int h) {
            int size = Math.round((kind == CLOSE ? 32 : 44) * dp);
            setMeasuredDimension(resolve(size, w), resolve(Math.round(44 * dp), h));
        }
        static int resolve(int want, int spec) {
            int mode = View.MeasureSpec.getMode(spec), size = View.MeasureSpec.getSize(spec);
            if (mode == View.MeasureSpec.EXACTLY) return size;
            if (mode == View.MeasureSpec.AT_MOST) return Math.min(want, size);
            return want;
        }
        @Override protected void onDraw(Canvas c) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f, r = (kind == CLOSE ? 5f : 8f) * dp;
            switch (kind) {
                case BACK:
                case FWD: {
                    float d = kind == BACK ? -1f : 1f;
                    c.drawLine(cx - d * r, cy, cx + d * r, cy, paint);
                    c.drawLine(cx + d * r, cy, cx + d * (r - 6f * dp), cy - 6f * dp, paint);
                    c.drawLine(cx + d * r, cy, cx + d * (r - 6f * dp), cy + 6f * dp, paint);
                    break;
                }
                case RELOAD: {
                    RectF box = new RectF(cx - r, cy - r, cx + r, cy + r);
                    c.drawArc(box, -60f, 290f, false, paint);
                    float ex = cx + r * 0.5f, ey = cy - r * 0.87f;
                    c.drawLine(ex, ey, ex + 6f * dp, ey - 1f * dp, paint);
                    c.drawLine(ex, ey, ex + 1f * dp, ey + 6f * dp, paint);
                    break;
                }
                case HOME: {
                    Path p = new Path();
                    p.moveTo(cx - r, cy);
                    p.lineTo(cx, cy - r);
                    p.lineTo(cx + r, cy);
                    c.drawPath(p, paint);
                    Path b = new Path();
                    b.moveTo(cx - r * 0.65f, cy - r * 0.35f);
                    b.lineTo(cx - r * 0.65f, cy + r);
                    b.lineTo(cx + r * 0.65f, cy + r);
                    b.lineTo(cx + r * 0.65f, cy - r * 0.35f);
                    c.drawPath(b, paint);
                    break;
                }
                case PLUS:
                    c.drawLine(cx - r, cy, cx + r, cy, paint);
                    c.drawLine(cx, cy - r, cx, cy + r, paint);
                    break;
                default:
                    c.drawLine(cx - r, cy - r, cx + r, cy + r, paint);
                    c.drawLine(cx - r, cy + r, cx + r, cy - r, paint);
            }
        }
    }

    final ArrayList<Tab> tabs = new ArrayList<>();
    Tab active;
    FrameLayout content;
    LinearLayout tabRow;
    EditText urlBox;
    View backBtn, fwdBtn;
    float dp;

    @Override
    protected void onCreate(Bundle b) {
        // The app's launch theme draws the splash picture and a title bar behind everything. Use a plain theme instead.
        setTheme(android.R.style.Theme_DeviceDefault_NoActionBar);
        super.onCreate(b);
        dp = getResources().getDisplayMetrics().density;
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        INK = dark ? Color.parseColor("#e6eef2") : Color.parseColor("#101b22");
        BAR = dark ? Color.parseColor("#0a1014") : Color.parseColor("#dfe5e8");
        TAB_ON = dark ? Color.parseColor("#1d2a32") : Color.WHITE;
        TAB_OFF = dark ? Color.parseColor("#131d23") : Color.parseColor("#eef2f4");
        getWindow().setBackgroundDrawable(new ColorDrawable(BAR));
        buildUi();
        Uri data = getIntent() == null ? null : getIntent().getData();
        String start = data != null && data.getScheme() != null && data.getScheme().startsWith("http") ? data.toString() : SITE_URL;
        openTab(start, false);
    }

    int px(int v) { return Math.round(v * dp); }

    Icon icon(int kind, View.OnClickListener l, String desc) {
        Icon i = new Icon(this, kind, INK, dp);
        i.setOnClickListener(l);
        i.setContentDescription(desc);
        return i;
    }

    /** Draw these bars in software: it avoids graphics glitches seen on some Chromebooks and tablets. */
    void safe(View v) {
        v.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        if (Build.VERSION.SDK_INT >= 29) v.setForceDarkAllowed(false);
    }

    void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BAR);
        if (Build.VERSION.SDK_INT >= 29) root.setForceDarkAllowed(false);
        root.setOnApplyWindowInsetsListener((v, insets) -> {   // keep clear of the status and navigation bars
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });

        // tab strip
        LinearLayout strip = new LinearLayout(this);
        strip.setOrientation(LinearLayout.HORIZONTAL);
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        tabRow = new LinearLayout(this);
        tabRow.setOrientation(LinearLayout.HORIZONTAL);
        safe(tabRow);
        scroll.addView(tabRow);
        strip.addView(scroll, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        strip.setBackgroundColor(BAR);
        safe(strip);
        strip.addView(icon(Icon.PLUS, v -> openTab(SITE_URL, false), "New tab"));
        root.addView(strip, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(42)));

        // toolbar
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(TAB_ON);
        safe(bar);
        backBtn = icon(Icon.BACK, v -> { if (active != null && active.web.canGoBack()) active.web.goBack(); }, "Back");
        fwdBtn = icon(Icon.FWD, v -> { if (active != null && active.web.canGoForward()) active.web.goForward(); }, "Forward");
        bar.addView(backBtn);
        bar.addView(fwdBtn);
        bar.addView(icon(Icon.RELOAD, v -> { if (active != null) active.web.reload(); }, "Reload"));
        urlBox = new EditText(this);
        urlBox.setSingleLine(true);
        urlBox.setTextSize(14);
        urlBox.setTextColor(INK);
        urlBox.setHintTextColor(Color.parseColor("#8a9aa3"));
        urlBox.setHint("Search or enter address");
        urlBox.setSelectAllOnFocus(true);
        urlBox.setImeOptions(EditorInfo.IME_ACTION_GO);
        urlBox.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        urlBox.setPadding(px(14), 0, px(14), 0);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(TAB_OFF);
        pill.setCornerRadius(px(18));
        urlBox.setBackground(pill);
        urlBox.setOnEditorActionListener((v, action, ev) -> {
            if (action == EditorInfo.IME_ACTION_GO || (ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                if (active != null) active.web.loadUrl(toUrl(urlBox.getText().toString()));
                hideKeyboard();
                return true;
            }
            return false;
        });
        LinearLayout.LayoutParams ulp = new LinearLayout.LayoutParams(0, px(38), 1f);
        ulp.setMargins(px(4), px(4), px(4), px(4));
        bar.addView(urlBox, ulp);
        bar.addView(icon(Icon.HOME, v -> { if (active != null) active.web.loadUrl(SITE_URL); }, "SPS Search home"));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, px(48)));

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(urlBox.getWindowToken(), 0);
        urlBox.clearFocus();
    }

    static String toUrl(String in) {
        String s = in == null ? "" : in.trim();
        if (s.isEmpty()) return SITE_URL;
        if (s.matches("(?i)^https?://\\S+$")) return s;
        if (!s.contains(" ") && (HOSTLIKE.matcher(s).matches() || s.matches("^localhost(:\\d+)?([/?#]\\S*)?$"))) return "https://" + s;
        try { return SITE_URL + "#/search?q=" + URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return SITE_URL; }
    }

    /* ---- tabs ---- */
    Tab openTab(String url, boolean popup) {
        final Tab t = new Tab();
        t.popup = popup;
        t.web = makeWebView(t);
        tabs.add(t);
        content.addView(t.web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        select(t);
        if (url != null) t.web.loadUrl(url);
        return t;
    }

    void select(Tab t) {
        active = t;
        for (Tab o : tabs) o.web.setVisibility(o == t ? View.VISIBLE : View.GONE);
        refreshUi();
    }

    void closeTab(Tab t) {
        int i = tabs.indexOf(t);
        if (i < 0) return;
        tabs.remove(t);
        content.removeView(t.web);
        t.web.destroy();
        if (tabs.isEmpty()) { finish(); return; }
        if (t == active) select(tabs.get(Math.min(i, tabs.size() - 1)));
        else refreshUi();
    }

    void refreshUi() {
        tabRow.removeAllViews();
        for (final Tab t : tabs) {
            LinearLayout chip = new LinearLayout(this);
            chip.setOrientation(LinearLayout.HORIZONTAL);
            chip.setGravity(Gravity.CENTER_VERTICAL);
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(t == active ? TAB_ON : TAB_OFF);
            bg.setCornerRadii(new float[]{px(8), px(8), px(8), px(8), 0, 0, 0, 0});
            chip.setBackground(bg);
            TextView title = new TextView(this);
            title.setText(t.title);
            title.setTextColor(INK);
            title.setTextSize(13);
            title.setSingleLine(true);
            title.setEllipsize(android.text.TextUtils.TruncateAt.END);
            title.setMaxWidth(px(130));
            title.setPadding(px(10), 0, px(4), 0);
            Icon x = icon(Icon.CLOSE, v -> closeTab(t), "Close tab");
            chip.addView(title);
            chip.addView(x);
            chip.setOnClickListener(v -> select(t));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, px(36));
            lp.setMargins(px(4), px(6), 0, 0);
            tabRow.addView(chip, lp);
        }
        if (active != null) {
            if (!urlBox.hasFocus()) {
                String u = active.web.getUrl();
                urlBox.setText(u == null ? "" : u);
            }
            backBtn.setAlpha(active.web.canGoBack() ? 1f : 0.35f);
            fwdBtn.setAlpha(active.web.canGoForward() ? 1f : 0.35f);
        }
    }

    boolean isSite(String url) { return url != null && url.startsWith(SITE_URL); }

    void external(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
    }

    WebView makeWebView(final Tab tab) {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setUserAgentString(s.getUserAgentString() + " SPSSearchApp"); // lets the website know it is inside the app
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);

        w.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String u = r.getUrl().toString();
                if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("file:") || u.startsWith("about:")) return false;
                external(u); // mailto:, tel:, app links
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap icon) {
                // A new window pointed at the SPS Search site is the sign-in link: Google refuses sign-in inside apps, so use the real browser.
                if (tab.popup && !tab.checked) {
                    tab.checked = true;
                    if (isSite(url)) { v.stopLoading(); external(url); closeTab(tab); return; }
                }
                if (tab == active && !urlBox.hasFocus() && url != null) urlBox.setText(url);
                refreshUi();
            }
            @Override public void onPageFinished(WebView v, String url) { refreshUi(); }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, android.webkit.WebResourceError e) {
                if (r.isForMainFrame()) {
                    v.loadData("<meta name=viewport content='width=device-width'><body style='font-family:sans-serif;text-align:center;padding:3rem'>"
                            + "<h2>Can't open this page</h2><p>Check your connection and try again.</p></body>", "text/html", "utf-8");
                }
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override public void onReceivedTitle(WebView v, String title) {
                if (title != null && !title.isEmpty()) { tab.title = title; refreshUi(); }
            }
            @Override public boolean onCreateWindow(WebView v, boolean dialog, boolean gesture, Message resultMsg) {
                Tab n = openTab(null, true);
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(n.web);
                resultMsg.sendToTarget();
                return true;
            }
            @Override public void onCloseWindow(WebView v) { closeTab(tab); }
        });
        return w;
    }

    @Override public void onBackPressed() {
        if (active != null && active.web.canGoBack()) active.web.goBack();
        else if (tabs.size() > 1) closeTab(active);
        else super.onBackPressed();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri d = intent.getData();
        if (d != null && d.getScheme() != null && d.getScheme().startsWith("http")) openTab(d.toString(), false);
    }

    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
}
