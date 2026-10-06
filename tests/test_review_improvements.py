import unittest
from unittest.mock import patch
from raf.book_import import stage_book, heading_position
from raf.structure import annotate
from raf.answers import answer, verified_citation
from raf.fielded_search import terms, ranked
from tests.test_book_import import export
from tests.helpers import bundle
from raf.policy import classify


class ReviewImprovements(unittest.TestCase):
    def test_personal_markers_do_not_match_inside_ordinary_words(self):
        self.assertEqual(classify('ما حكم الرمي في اليوم الثاني؟'),'explain')
        self.assertEqual(classify('إني حلفت ثم نسيت هل علي كفارة؟'),'refer')
    def test_short_bracketed_heading_and_glyph_match(self):
        self.assertEqual(heading_position('نهاية * * * (باب قصير) س سؤال','(باب قصير)'),12)
        self.assertIsNotNone(heading_position('عنوان يوسف ﵇ س سؤال','عنوان يوسف عليه السلام'))
        self.assertIsNone(heading_position('إن الحج من أجل الدنيا','الحج؟؟'))

    def test_source_incomplete_stays_saved_but_is_not_retrievable(self):
        u=bundle()['units'][0]
        original=u['text']
        annotate(u,{u['sha256']:{'status':'source_incomplete','reason':'fixture'}})
        self.assertFalse(u['retrievable']);self.assertEqual(u['text'],original)
        self.assertEqual(u['verification'],'reviewed')  # No review field is forged by annotate.

    def test_quote_tampering_is_detected(self):
        u=bundle()['units'][0];u['text']+=' changed'
        with self.assertRaises(ValueError):verified_citation(u,u['text'])

    def test_question_split_by_toc_continuation_is_rejoined(self):
        data=export()
        data['pages'][0]['body']='عنوان طويل س - بداية السؤال ولم يكتمل'
        data['pages'][1]['body']='فهل يجوز هذا؟ ج - جواب كامل الشيخ ابن باز'
        data['toc']=[dict(title_id=1,parent_id=None,page_id=11,title_text='عنوان طويل'),
                     dict(title_id=2,parent_id=1,page_id=12,title_text='فهل يجوز هذا؟')]
        result,_=stage_book(data,complete=True)
        self.assertEqual(len(result['units']),1)
        self.assertIn('بداية السؤال ولم يكتمل\nفهل يجوز',result['units'][0]['text'])

    def test_fielded_normalization_and_no_heading_result(self):
        self.assertIn('زكاة',terms('زكاته'))
        data=bundle();u=data['units'][0]
        data['units'].append(dict(u,id='heading',retrievable=False,title='alpha',text='alpha'))
        self.assertEqual([x['id'] for x,_ in ranked(data,'alpha','lexical',None)],['unit-one'])

    def test_unsupported_best_match_cannot_be_replaced_by_incidental_lower_match(self):
        data=bundle();data['manifest']['retrieval']={'mode':'hybrid','algorithm':'fielded-v2'}
        data['model']='fixture'
        class Memory:
            def release(self,*args):return data
        low={'coverage':0,'focus':.9,'dense':.9};high={'coverage':1,'focus':.9,'dense':.9}
        with patch('raf.fielded_search.ranked',return_value=[(data['units'][0],low),(data['units'][0],high)]):
            self.assertEqual(answer(Memory(),'testbook','alpha specific question')['kind'],'insufficient')

    def test_close_weak_matches_request_clarification_without_quoting(self):
        data=bundle();data['manifest']['retrieval']={'mode':'hybrid','algorithm':'fielded-v2'}
        data['model']='fixture'
        class Memory:
            def release(self,*args):return data
        one={'coverage':.8,'focus':.86,'dense':.87,'score':.70}
        two=dict(one,score=.69)
        with patch('raf.fielded_search.ranked',return_value=[(data['units'][0],one),(data['units'][0],two)]):
            result=answer(Memory(),'testbook','alpha specific question')
            self.assertEqual(result['kind'],'clarify')
            self.assertEqual(result['citations'],[])
            self.assertTrue(result['suggestions'])

    def test_concepts_are_word_level_not_query_or_document_overrides(self):
        self.assertEqual(terms('الإنابة'),terms('التوكيل'))
        self.assertEqual(terms('بأقساط'),terms('التقسيط'))
        self.assertEqual(terms('بأقساط سيارة جديدة'),terms('التقسيط سيارة جديدة'))
