// Package htmlextract is a web page's readable text as markdown: the
// reader pipeline of attention's WebViewerReader
// (apps/web/builtin/webviewer/WebViewerReader.ts) — Readability's article,
// then HTML to markdown — over Go ports of both (readeck's go-readability,
// html-to-markdown), and the GET that brings a page with no web view.
package htmlextract

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"codeberg.org/readeck/go-readability/v2"
	htmltomarkdown "github.com/JohannesKaufmann/html-to-markdown/v2"
	"golang.org/x/net/html"
)

// MaxPage is the largest page read.
const MaxPage = 10 << 20

// Result is a page's article (WebViewerReaderResult).
type Result struct {
	Title    string
	SiteName string
	URL      string
	Markdown string
}

// Extract is html's article, its links made absolute against pageURL
// (extractFromPage): its title, else its site's name, else "Untitled".
func Extract(html []byte, pageURL string) (Result, error) {
	u, err := url.Parse(pageURL)
	if err != nil {
		return Result{}, err
	}
	art, err := readability.FromReader(bytes.NewReader(html), u)
	if err != nil {
		return Result{}, err
	}
	if art.Node == nil {
		return Result{}, errors.New("No readable content found on this page")
	}
	absolutize(art.Node, u)
	md, err := htmltomarkdown.ConvertNode(art.Node)
	if err != nil {
		return Result{}, err
	}
	site := strings.TrimSpace(art.SiteName())
	if site == "" {
		site = u.Hostname()
	}
	title := strings.TrimSpace(art.Title())
	if title == "" {
		title = strings.TrimSpace(art.SiteName())
	}
	if title == "" {
		title = "Untitled"
	}
	return Result{Title: title, SiteName: site, URL: pageURL, Markdown: strings.TrimSpace(string(md))}, nil
}

// absolutize resolves n's links and images against the page
// (absolutizeUrl): a "#note" link is the page's, not the site's.
func absolutize(n *html.Node, base *url.URL) {
	if n.Type == html.ElementNode {
		for i, a := range n.Attr {
			if a.Key != "href" && a.Key != "src" {
				continue
			}
			if ref, err := url.Parse(strings.TrimSpace(a.Val)); err == nil {
				n.Attr[i].Val = base.ResolveReference(ref).String()
			}
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		absolutize(c, base)
	}
}

// Document is r as a note: its title, its source, its article.
func (r Result) Document() string {
	return fmt.Sprintf("# %s\n\nSource: %s\n\n%s\n", r.Title, r.URL, r.Markdown)
}

// userAgent is a browser's, as a site serves the page a reader sees.
const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

var client = &http.Client{Timeout: 30 * time.Second}

// Fetch GETs address, up to MaxPage, and says where it ended after
// redirects.
func Fetch(ctx context.Context, address string) (html []byte, final string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("%s: %s", address, resp.Status)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" && !strings.Contains(ct, "html") {
		return nil, "", fmt.Errorf("%s is %s, not a web page", address, ct)
	}
	html, err = io.ReadAll(io.LimitReader(resp.Body, MaxPage))
	return html, resp.Request.URL.String(), err
}
